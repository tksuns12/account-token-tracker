import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import {
  parseAntigravityTranscriptContent,
  scanAntigravityLocalDeltas
} from './antigravity-logs'
import {
  parseClaudeJsonlContent,
  parseClaudeJsonlIncremental,
  scanClaudeLocalDeltas
} from './claude-logs'
import {
  applySnapshot,
  buildDashboardView,
  classifyLedgerEntries,
  createEmptyState,
  filterModelsForWindow,
  getIsoWeekKey,
  getMonthKey,
  migrateState,
  parseAccountListResponse,
  type QuotaWindowSample
} from './model'
import { computeUsageCostUsd, formatUsd, formatUsdCompact } from './pricing'
import * as main from './worker'

test('parses Claude JSONL deduplicating multi-block messages and computes model USD', () => {
  const jsonl = [
    JSON.stringify({
      message: {
        id: 'msg_1',
        model: 'claude-opus-5-5',
        usage: {
          input_tokens: 1000,
          output_tokens: 2000,
          cache_creation_input_tokens: 10000,
          cache_read_input_tokens: 50000,
          cache_creation: { ephemeral_1h_input_tokens: 10000, ephemeral_5m_input_tokens: 0 }
        }
      }
    }),
    // Duplicate block with same message.id must NOT double count
    JSON.stringify({
      message: {
        id: 'msg_1',
        model: 'claude-opus-5-5',
        usage: {
          input_tokens: 1000,
          output_tokens: 2000,
          cache_creation_input_tokens: 10000,
          cache_read_input_tokens: 50000,
          cache_creation: { ephemeral_1h_input_tokens: 10000, ephemeral_5m_input_tokens: 0 }
        }
      }
    }),
    // Synthetic message must be ignored
    JSON.stringify({
      message: {
        id: 'msg_syn',
        model: '<synthetic>',
        usage: { input_tokens: 99999, output_tokens: 99999 }
      }
    }),
    JSON.stringify({
      message: {
        id: 'msg_2',
        model: 'claude-sonnet-5-5',
        usage: {
          input_tokens: 10000,
          output_tokens: 10000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        }
      }
    })
  ].join('\n')

  const models = parseClaudeJsonlContent(jsonl)
  assert.equal(Object.keys(models).length, 2)
  assert.equal(models['claude-opus-5-5'].outputTokens, 2000)
  // Opus 5.5: $5 in, $25 out, $10 cache1h, $0.50 cacheRead
  assert.equal(Number(models['claude-opus-5-5'].costUsd.toFixed(4)), 0.18)
  assert.equal(Number(models['claude-sonnet-5-5'].costUsd.toFixed(4)), 0.18)
})

test('Claude incremental parser filters old timestamps and diffs cross-poll streaming blocks', () => {
  const now = Date.UTC(2026, 10, 23, 6, 0, 0)
  const chunk1 = [
    // Historical record older than sinceMs must be skipped
    JSON.stringify({
      timestamp: new Date(now - 3_600_000).toISOString(),
      message: {
        id: 'msg_old',
        model: 'claude-sonnet-5-5',
        usage: { input_tokens: 1_000_000, output_tokens: 500_000 }
      }
    }),
    // Streaming block 1 of msg_stream
    JSON.stringify({
      timestamp: new Date(now).toISOString(),
      message: {
        id: 'msg_stream',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 1000, output_tokens: 200 }
      }
    })
  ].join('\n')

  const res1 = parseClaudeJsonlIncremental(chunk1, undefined, { sinceMs: now - 60_000 })
  assert.equal(res1.models['claude-sonnet-5-5'], undefined)
  assert.equal(res1.models['claude-opus-5-5'].outputTokens, 200)
  assert.equal(res1.models['claude-opus-5-5'].inputTokens, 1000)

  // Streaming block 2 of same msg_stream arrives in next poll with cumulative usage
  const chunk2 = JSON.stringify({
    timestamp: new Date(now + 5_000).toISOString(),
    message: {
      id: 'msg_stream',
      model: 'claude-opus-5-5',
      usage: { input_tokens: 1000, output_tokens: 700 }
    }
  })
  const res2 = parseClaudeJsonlIncremental(chunk2, undefined, {
    prevMessageUsage: res1.nextMessageUsage
  })
  // Only the +500 output token increment is counted, NOT 1000 input + 700 output again
  assert.equal(res2.models['claude-opus-5-5'].inputTokens, 0)
  assert.equal(res2.models['claude-opus-5-5'].outputTokens, 500)
})

test('scanners treat empty prevOffsets as baseline to prevent historical backfill spikes', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'att-scan-'))
  try {
    const claudeProj = path.join(tmpRoot, 'claude-proj')
    fs.mkdirSync(claudeProj, { recursive: true })
    const claudeFile = path.join(claudeProj, 'sess.jsonl')
    fs.writeFileSync(
      claudeFile,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg_huge',
          model: 'claude-sonnet-5-5',
          usage: { input_tokens: 0, output_tokens: 5_000_000 }
        }
      }) + '\n'
    )

    // Even when isBaseline=false (e.g. upgraded from older state), empty prevOffsets must NOT ingest history
    const claudeRes = scanClaudeLocalDeltas({}, false, Date.now() - 10_000, undefined, {
      projectsDir: tmpRoot
    })
    assert.equal(claudeRes.deltaTokens, 0)
    assert.equal(claudeRes.deltaCostUsd, 0)
    assert.ok(claudeRes.nextOffsets['claude-proj/sess.jsonl'] > 0)

    // Same for Antigravity scanner
    const agBrain = path.join(tmpRoot, 'antigravity-cli', 'brain')
    const agLogs = path.join(agBrain, 'conv-1', '.system_generated', 'logs')
    fs.mkdirSync(agLogs, { recursive: true })
    fs.writeFileSync(
      path.join(agLogs, 'transcript.jsonl'),
      JSON.stringify({
        step_index: 1,
        model: 'gemini-4-neon-high',
        input_tokens: 1_000_000,
        output_tokens: 500_000,
        cache_read_tokens: 0
      }) + '\n'
    )

    const agRes = scanAntigravityLocalDeltas({}, false, Date.now() - 10_000, undefined, {
      brainDirs: [agBrain]
    })
    assert.equal(agRes.deltaTokens, 0)
    assert.equal(agRes.deltaCostUsd, 0)
    assert.ok(Object.keys(agRes.nextOffsets).length === 1)
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  }
})

test('parses Antigravity transcript.jsonl and routes models to matching quota buckets', () => {
  const transcript = [
    JSON.stringify({
      step_index: 1,
      model: 'gemini-4-neon-medium',
      input_tokens: 100_000,
      cache_read_tokens: 200_000,
      output_tokens: 10_000
    }),
    JSON.stringify({
      step_index: 2,
      model: 'claude-opus-5-5',
      input_tokens: 10_000,
      cache_read_tokens: 0,
      output_tokens: 5_000
    })
  ].join('\n')

  const seen = new Set<string>()
  const models = parseAntigravityTranscriptContent(transcript, undefined, {
    fileKey: 'conv-1',
    seenSteps: seen
  })
  assert.equal(Object.keys(models).length, 2)
  assert.equal(models['gemini-4-neon-medium'].totalTokens, 310_000)
  assert.ok(models['gemini-4-neon-medium'].costUsd > 0)

  // Re-reading same chunk with seenSteps yields 0 duplicates
  const dupModels = parseAntigravityTranscriptContent(transcript, undefined, {
    fileKey: 'conv-1',
    seenSteps: seen
  })
  assert.equal(Object.keys(dupModels).length, 0)

  const geminiOnly = filterModelsForWindow(
    'antigravity',
    'bucket:gemini_models_weekly',
    'Gemini Models · Weekly',
    models
  )
  assert.deepEqual(Object.keys(geminiOnly), ['gemini-4-neon-medium'])

  const claudeGptOnly = filterModelsForWindow(
    'antigravity',
    'bucket:claude_and_gpt_models_weekly',
    'Claude and GPT models · Weekly',
    models
  )
  assert.deepEqual(Object.keys(claudeGptOnly), ['claude-opus-5-5'])

  const fableOnly = filterModelsForWindow('claude', 'fableWeekly', 'Fable Weekly (7d)', models)
  assert.deepEqual(Object.keys(fableOnly), [])
})

test('parses orca account list --json output across providers, buckets, and fableWeekly', () => {
  const sample = {
    ok: true,
    result: {
      claude: { accounts: [], activeAccountId: null },
      antigravity: { accounts: [], activeAccountId: null },
      rateLimits: {
        claude: {
          provider: 'claude',
          status: 'ok',
          planType: 'max_20x',
          weekly: {
            usedPercent: 20,
            windowMinutes: 10080,
            resetsAt: 1795694400308,
            resetDescription: 'Thu 9:00 PM'
          },
          fableWeekly: {
            usedPercent: 0,
            windowMinutes: 10080,
            resetsAt: 1795694400000,
            resetDescription: 'Thu 9:00 PM'
          },
          usageMetadata: { authProvenance: 'system' }
        },
        antigravity: {
          provider: 'antigravity',
          status: 'ok',
          buckets: [
            {
              name: 'Gemini Models · Five Hour',
              usedPercent: 2,
              windowMinutes: 300,
              resetsAt: 1795173329000
            }
          ]
        }
      }
    }
  }

  const parsed = parseAccountListResponse(sample)
  assert.equal(parsed.length, 3)
  assert.equal(parsed[0].windowId, 'weekly')
  assert.equal(parsed[1].windowId, 'fableWeekly')
  assert.equal(parsed[2].provider, 'antigravity')
})

test('excludes legacy $0 periods and >$100/1% spike outliers from trends while preserving raw ledger', () => {
  const week1 = Date.UTC(2026, 10, 9, 12, 0, 0) // 2026-W46
  const week2 = Date.UTC(2026, 10, 16, 12, 0, 0) // 2026-W47
  const week3 = Date.UTC(2026, 10, 23, 12, 0, 0) // 2026-W48

  const state = createEmptyState()
  state.lastPollAt = week3
  state.windows['claude::acc-1::weekly'] = {
    key: 'claude::acc-1::weekly',
    provider: 'claude',
    accountId: 'acc-1',
    accountLabel: 'Claude (max_20x)',
    planType: 'max_20x',
    isActiveAccount: true,
    windowId: 'weekly',
    windowLabel: 'Weekly (7d)',
    windowMinutes: 10080,
    resetsAt: week3 + 3 * 86_400_000,
    resetDescription: 'Thu 9:00 PM',
    baselinePercent: 57,
    currentPercent: 60,
    trackedDeltaPercent: 3,
    trackedTokens: 1_500_000_000,
    pendingTokens: 0,
    trackedCostUsd: 655,
    pendingCostUsd: 0,
    trackedModels: {},
    pendingModels: {},
    firstSeenAt: week3 - 3_600_000,
    lastUpdatedAt: week3
  }
  state.ledger = [
    // Valid jump in W48: $10 for +1%
    {
      id: 'valid-w48',
      timestamp: week3,
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      fromPercent: 59,
      toPercent: 60,
      deltaPercent: 1,
      deltaTokens: 2_000_000,
      tokensPerPercent: 2_000_000,
      deltaCostUsd: 10,
      usdPerPercent: 10,
      models: {
        'claude-opus-5-5': {
          inputTokens: 100_000,
          outputTokens: 300_000,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 1_600_000,
          totalTokens: 2_000_000,
          costUsd: 10
        }
      },
      sessionTitles: []
    },
    // Backfill spike outlier in W48: $611 for +1%
    {
      id: 'spike-w48',
      timestamp: week3 - 60_000,
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      fromPercent: 58,
      toPercent: 59,
      deltaPercent: 1,
      deltaTokens: 1_400_000_000,
      tokensPerPercent: 1_400_000_000,
      deltaCostUsd: 611,
      usdPerPercent: 611,
      models: {},
      sessionTitles: []
    },
    // Legacy $0 entry in W47
    {
      id: 'legacy-w47',
      timestamp: week2,
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      fromPercent: 10,
      toPercent: 20,
      deltaPercent: 10,
      deltaTokens: 50_000_000,
      tokensPerPercent: 5_000_000,
      deltaCostUsd: 0,
      usdPerPercent: 0,
      models: {},
      sessionTitles: []
    }
  ]
  state.periodStats = {
    [`week::${getIsoWeekKey(week2)}::claude::acc-1::weekly`]: {
      key: `week::${getIsoWeekKey(week2)}::claude::acc-1::weekly`,
      periodType: 'week',
      periodKey: getIsoWeekKey(week2),
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      totalDeltaPercent: 10,
      totalDeltaTokens: 50_000_000,
      totalDeltaCostUsd: 0,
      models: {},
      sampleCount: 1,
      firstTimestamp: week2,
      lastTimestamp: week2
    },
    [`week::${getIsoWeekKey(week3)}::claude::acc-1::weekly`]: {
      key: `week::${getIsoWeekKey(week3)}::claude::acc-1::weekly`,
      periodType: 'week',
      periodKey: getIsoWeekKey(week3),
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      totalDeltaPercent: 2,
      totalDeltaTokens: 1_402_000_000,
      totalDeltaCostUsd: 621,
      models: {},
      sampleCount: 2,
      firstTimestamp: week3 - 60_000,
      lastTimestamp: week3
    }
  }

  const classified = classifyLedgerEntries(state.ledger)
  assert.equal(classified[0].quality, 'valid')
  assert.equal(classified[1].quality, 'outlier')
  assert.equal(classified[2].quality, 'zero_cost')

  const view = buildDashboardView(state, 15, week3)
  // Raw ledger is preserved
  assert.equal(view.ledger.length, 3)
  assert.equal(view.ledgerViews.length, 3)
  // Series picks W48 as clean USD baseline (ignoring legacy $0 W47 and $611 spike)
  assert.equal(view.weeklySeries.length, 1)
  assert.equal(view.weeklySeries[0].metricKind, 'usd')
  assert.equal(view.weeklySeries[0].latestUsdPerPercent, 10)
  assert.equal(view.weeklySeries[0].excludedOutlierCount, 1)
  assert.equal(view.weeklySeries[0].excludedZeroCount, 1)
  // Window view also reflects clean outlier-excluded cost ($10 instead of $655)
  assert.equal(view.windows[0].trackedCostUsd, 10)
  assert.equal(view.windows[0].excludedOutlierCount, 1)
  // Account grouping works
  assert.equal(view.accounts.length, 1)
  assert.equal(view.accounts[0].totalTrackedCostUsd, 10)
  assert.ok(view.accounts[0].windows[0].resetCountdownText?.includes('3일'))
  assert.equal(formatUsd(7384), '$7,384')
  assert.equal(formatUsdCompact(12500), '$12.5K')
  assert.ok(week1 < week2)
})

test('tracks per-model USD per 1% and detects enshittification drop in $/1%', () => {
  const baseQuota: QuotaWindowSample = {
    provider: 'claude',
    accountId: 'acc-1',
    accountLabel: 'Claude (max_20x)',
    planType: 'max_20x',
    isActiveAccount: true,
    windowId: 'weekly',
    windowLabel: 'Weekly (7d)',
    windowMinutes: 10080,
    usedPercent: 10,
    resetsAt: 2_000_000_000_000,
    resetDescription: 'Thu 9:00 PM'
  }

  const week1 = Date.UTC(2026, 10, 9, 12, 0, 0) // 2026-W46
  const week2 = Date.UTC(2026, 10, 16, 12, 0, 0) // 2026-W47

  let state = applySnapshot(
    createEmptyState(),
    [baseQuota],
    [
      {
        sessionId: 's1',
        agent: 'claude',
        title: 'Task',
        updatedAt: week1,
        createdAt: week1,
        totalTokens: 100_000,
        models: {
          'claude-opus-5-5': {
            inputTokens: 0,
            outputTokens: 100_000,
            cacheWrite5mTokens: 0,
            cacheWrite1hTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 100_000,
            costUsd: 2.5
          }
        }
      }
    ],
    week1
  )

  // Week 1: +2% for $4.00 -> $2.00 / 1%
  state = applySnapshot(
    state,
    [{ ...baseQuota, usedPercent: 12 }],
    [
      {
        sessionId: 's1',
        agent: 'claude',
        title: 'Task',
        updatedAt: week1 + 60_000,
        createdAt: week1,
        totalTokens: 260_000,
        models: {
          'claude-opus-5-5': {
            inputTokens: 0,
            outputTokens: 260_000,
            cacheWrite5mTokens: 0,
            cacheWrite1hTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 260_000,
            costUsd: 6.5
          }
        }
      }
    ],
    week1 + 60_000
  )

  // Week 2: +2% for $3.00 -> $1.50 / 1% (-25% drop vs baseline $2.00/1%!)
  state = applySnapshot(
    state,
    [{ ...baseQuota, usedPercent: 14 }],
    [
      {
        sessionId: 's1',
        agent: 'claude',
        title: 'Task',
        updatedAt: week2,
        createdAt: week1,
        totalTokens: 380_000,
        models: {
          'claude-opus-5-5': {
            inputTokens: 0,
            outputTokens: 380_000,
            cacheWrite5mTokens: 0,
            cacheWrite1hTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 380_000,
            costUsd: 9.5
          }
        }
      }
    ],
    week2
  )

  const view = buildDashboardView(state, 15, week2)
  assert.equal(view.weeklySeries.length, 1)
  assert.equal(view.weeklySeries[0].metricKind, 'usd')
  assert.equal(view.weeklySeries[0].baselineUsdPerPercent, 2.0)
  assert.equal(view.weeklySeries[0].latestUsdPerPercent, 1.5)
  assert.equal(Math.round(view.weeklySeries[0].baselineMonthlyUsd), 857)
  assert.equal(Math.round(view.weeklySeries[0].latestMonthlyUsd), 643)
  assert.equal(Math.round(view.weeklySeries[0].vsBaselinePercent ?? 0), -25)
  assert.equal(view.weeklySeries[0].status, 'degraded')
  assert.equal(view.weeklySeries[0].points.length, 2)
  assert.equal(view.degradedAlerts.length, 1)

  assert.ok(state.periodStats[`week::${getIsoWeekKey(week1 + 60_000)}::claude::acc-1::weekly`])
  assert.ok(state.periodStats[`month::${getMonthKey(week2)}::claude::acc-1::weekly`])

  // Verify 5h burst windows are excluded from monthly-value trends
  const stateWith5h = {
    ...state,
    periodStats: {
      ...state.periodStats,
      'week::2026-W47::antigravity::host::bucket:gemini_models_five_hour': {
        key: 'week::2026-W47::antigravity::host::bucket:gemini_models_five_hour',
        periodType: 'week' as const,
        periodKey: '2026-W47',
        provider: 'antigravity',
        accountId: 'host',
        accountLabel: 'Antigravity (host)',
        windowId: 'bucket:gemini_models_five_hour',
        windowLabel: 'Gemini Models · Five Hour',
        windowMinutes: 300,
        totalDeltaPercent: 20,
        totalDeltaTokens: 1_000_000,
        totalDeltaCostUsd: 10,
        models: {},
        sampleCount: 5,
        firstTimestamp: week2,
        lastTimestamp: week2
      }
    }
  }
  const filteredView = buildDashboardView(stateWith5h, 15, week2)
  assert.equal(filteredView.weeklySeries.length, 1)
  assert.equal(filteredView.weeklySeries[0].windowId, 'weekly')
})

test('migrates v1 state cleanly to v4 and custom pricing overrides work', () => {
  const migrated = migrateState({
    version: 1,
    lastPollAt: 1000,
    lastError: null,
    windows: {},
    ledger: [],
    sessionTokens: {}
  })
  assert.equal(migrated.version, 4)
  assert.deepEqual(migrated.recentClaudeMessageUsage, {})
  assert.deepEqual(migrated.recentAntigravitySteps, [])

  const customUsd = computeUsageCostUsd(
    'claude-opus-5-5',
    {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheReadTokens: 0
    },
    { 'claude-opus-5-5': { input: 12, output: 60 } }
  )
  assert.equal(customUsd, 12)
})

test('worker refreshes using local Claude logs and exports trends CSV with USD', async () => {
  let step = 0
  main.setAccountListFetcherForTests(async () => [
    {
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'alice@example.com',
      planType: 'max_20x',
      isActiveAccount: true,
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      usedPercent: step === 0 ? 20 : 22,
      resetsAt: 2_000_000_000_000,
      resetDescription: 'Thu 9:00 PM'
    }
  ])
  main.setClaudeDeltaFetcherForTests((_offsets, isBaseline) => {
    if (isBaseline) {
      return {
        nextOffsets: { 'proj/s1.jsonl': 1000 },
        nextMessageUsage: {},
        deltaModels: {},
        deltaTokens: 0,
        deltaCostUsd: 0,
        hasLocalLogs: true
      }
    }
    return {
      nextOffsets: { 'proj/s1.jsonl': 2500 },
      nextMessageUsage: {},
      deltaModels: {
        'claude-opus-5-5': {
          inputTokens: 0,
          outputTokens: 120_000,
          cacheWrite5mTokens: 0,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 120_000,
          costUsd: 3.0
        }
      },
      deltaTokens: 120_000,
      deltaCostUsd: 3.0,
      hasLocalLogs: true
    }
  })

  try {
    const host = mockHost({
      results: {
        'agent.listSessions': () => ({
          sessions: [
            {
              sessionId: 'codex-1',
              agent: 'codex',
              title: 'Codex task',
              workspaceId: null,
              hostId: 'local',
              branch: null,
              createdAt: Date.now() - 500,
              updatedAt: Date.now(),
              messageCount: 2,
              totalTokens: 5000,
              running: false
            }
          ],
          truncated: false
        })
      }
    })

    const worker = await mountWorker(main, { host })
    await worker.request('tracker.refresh')
    step = 1
    const view = (await worker.request('tracker.refresh')) as unknown as {
      windows: Array<{ usdPerPercent: number; estimated100PercentUsd: number }>
      weeklyRows: Array<{ usdPerPercent: number }>
      accounts: Array<{ accountLabel: string }>
    }

    assert.equal(view.windows[0].usdPerPercent, 1.5)
    assert.equal(view.windows[0].estimated100PercentUsd, 150)
    assert.equal(view.weeklyRows[0].usdPerPercent, 1.5)
    assert.equal(view.accounts[0].accountLabel, 'alice@example.com')

    const csvRes = (await worker.request('tracker.exportTrendsCsv', {
      granularity: 'week'
    })) as unknown as { filename: string; csv: string }
    assert.ok(csvRes.csv.includes('usd_per_1pct'))
    assert.ok(csvRes.csv.includes('1.5000'))
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    main.setAccountListFetcherForTests(null)
    main.setClaudeDeltaFetcherForTests(null)
  }
})

test('shards storage keys and keeps every storage write & panel payload under 256 KiB', async () => {
  // Simulate legacy trackerState with huge offset map (>200 KiB alone)
  const hugeOffsets: Record<string, number> = {}
  for (let i = 0; i < 1200; i++) {
    hugeOffsets[`-Users-demo-very-long-workspace-path-project-${i}/session-${i}-uuid-1234567890.jsonl`] =
      100_000 + i
  }

  main.setAccountListFetcherForTests(async () => [
    {
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'Claude (max_20x)',
      planType: 'max_20x',
      isActiveAccount: true,
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      usedPercent: 30,
      resetsAt: 2_000_000_000_000,
      resetDescription: 'Thu 9:00 PM'
    }
  ])
  main.setClaudeDeltaFetcherForTests(() => ({
    nextOffsets: hugeOffsets,
    nextMessageUsage: {},
    deltaModels: {},
    deltaTokens: 0,
    deltaCostUsd: 0,
    hasLocalLogs: true
  }))

  try {
    const host = mockHost({
      storage: {
        trackerState: {
          version: 3,
          lastPollAt: Date.now() - 60_000,
          lastError: null,
          windows: {},
          ledger: [],
          periodStats: {},
          sessionTokens: {},
          claudeFileOffsets: {},
          antigravityFileOffsets: {}
        }
      }
    })

    const worker = await mountWorker(main, { host })
    const panelPayload = await worker.request('tracker.refresh')

    const storage = host.data().storage
    assert.ok(storage.trackerCore)
    assert.ok(storage.trackerLedger)
    assert.ok(storage.trackerLogCursors)
    assert.equal(storage.trackerState, undefined)

    for (const [key, val] of Object.entries(storage)) {
      const bytes = Buffer.byteLength(JSON.stringify(val), 'utf8')
      assert.ok(bytes < 262_144, `storage key ${key} exceeded 256 KiB (${bytes})`)
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(panelPayload), 'utf8')
    assert.ok(payloadBytes < 262_144, `panel payload exceeded 256 KiB (${payloadBytes})`)
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    main.setAccountListFetcherForTests(null)
    main.setClaudeDeltaFetcherForTests(null)
  }
})
