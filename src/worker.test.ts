import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { parseAntigravityTranscriptContent } from './antigravity-logs'
import { parseClaudeJsonlContent } from './claude-logs'
import {
  applySnapshot,
  buildDashboardView,
  createEmptyState,
  filterModelsForWindow,
  getIsoWeekKey,
  getMonthKey,
  migrateState,
  parseAccountListResponse,
  type QuotaWindowSample
} from './model'
import { computeUsageCostUsd } from './pricing'
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
  // (1000*5 + 2000*25 + 10000*10 + 50000*0.5) / 1e6 = (5000 + 50000 + 100000 + 25000)/1e6 = $0.18
  assert.equal(Number(models['claude-opus-5-5'].costUsd.toFixed(4)), 0.18)
  // Sonnet 5.5: $3 in, $15 out => (10000*3 + 10000*15)/1e6 = $0.18
  assert.equal(Number(models['claude-sonnet-5-5'].costUsd.toFixed(4)), 0.18)
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

  const models = parseAntigravityTranscriptContent(transcript)
  assert.equal(Object.keys(models).length, 2)
  assert.equal(models['gemini-4-neon-medium'].totalTokens, 310_000)
  assert.ok(models['gemini-4-neon-medium'].costUsd > 0)

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
})

test('parses orca account list --json output across providers and buckets', () => {
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
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].provider, 'claude')
  assert.equal(parsed[1].provider, 'antigravity')
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

  // Baseline poll
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

  const view = buildDashboardView(state, 15)
  assert.equal(view.weeklySeries.length, 1)
  assert.equal(view.weeklySeries[0].metricKind, 'usd')
  assert.equal(view.weeklySeries[0].baselineUsdPerPercent, 2.0)
  assert.equal(view.weeklySeries[0].latestUsdPerPercent, 1.5)
  // Weekly (7d): 30/7 cycles per month => $200 * 30/7 ≈ $857.14, $150 * 30/7 ≈ $642.86
  assert.equal(Math.round(view.weeklySeries[0].baselineMonthlyUsd), 857)
  assert.equal(Math.round(view.weeklySeries[0].latestMonthlyUsd), 643)
  assert.equal(Math.round(view.weeklySeries[0].vsBaselinePercent ?? 0), -25)
  assert.equal(view.weeklySeries[0].status, 'degraded')
  assert.equal(view.degradedAlerts.length, 1)

  // Verify week/month keys
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
  const filteredView = buildDashboardView(stateWith5h, 15)
  assert.equal(filteredView.weeklySeries.length, 1)
  assert.equal(filteredView.weeklySeries[0].windowId, 'weekly')
})

test('migrates v1 state cleanly to v3 and custom pricing overrides work', () => {
  const migrated = migrateState({
    version: 1,
    lastPollAt: 1000,
    lastError: null,
    windows: {},
    ledger: [],
    sessionTokens: {}
  })
  assert.equal(migrated.version, 3)

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
        deltaModels: {},
        deltaTokens: 0,
        deltaCostUsd: 0,
        hasLocalLogs: true
      }
    }
    return {
      nextOffsets: { 'proj/s1.jsonl': 2500 },
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
    }

    assert.equal(view.windows[0].usdPerPercent, 1.5)
    assert.equal(view.windows[0].estimated100PercentUsd, 150)
    assert.equal(view.weeklyRows[0].usdPerPercent, 1.5)

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
