import { assert, mockHost, mountWorker, test } from 'orca/testing'
import {
  applySnapshot,
  buildDashboardView,
  createEmptyState,
  getIsoWeekKey,
  getMonthKey,
  migrateState,
  parseAccountListResponse,
  type QuotaWindowSample
} from './model'
import * as main from './worker'

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
        },
        codex: {
          provider: 'codex',
          status: 'unavailable'
        }
      }
    }
  }

  const parsed = parseAccountListResponse(sample)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].provider, 'claude')
  assert.equal(parsed[0].usedPercent, 20)
  assert.equal(parsed[0].accountLabel, 'Claude (max_20x)')
  assert.equal(parsed[1].provider, 'antigravity')
  assert.equal(parsed[1].windowLabel, 'Gemini Models · Five Hour')
})

test('buffers pending tokens until integer % jumps and rolls up weekly/monthly stats', () => {
  const baseQuota: QuotaWindowSample = {
    provider: 'claude',
    accountId: 'acc-1',
    accountLabel: 'work@example.com',
    planType: 'max_20x',
    isActiveAccount: true,
    windowId: 'session',
    windowLabel: '5h Session',
    windowMinutes: 300,
    usedPercent: 10,
    resetsAt: 2_000_000_000_000,
    resetDescription: '5:00 PM'
  }

  const t1 = Date.UTC(2026, 10, 16, 10, 0, 0) // 2026-W47, 2026-11
  const t2 = t1 + 60_000
  const t3 = t2 + 60_000

  let state = applySnapshot(
    createEmptyState(),
    [baseQuota],
    [{ sessionId: 's1', agent: 'claude', title: 'Task A', updatedAt: t1, createdAt: t1 - 100, totalTokens: 50_000 }],
    t1
  )
  assert.equal(state.ledger.length, 0)

  state = applySnapshot(
    state,
    [baseQuota],
    [{ sessionId: 's1', agent: 'claude', title: 'Task A', updatedAt: t2, createdAt: t1 - 100, totalTokens: 90_000 }],
    t2
  )
  assert.equal(state.ledger.length, 0)
  assert.equal(state.windows['claude::acc-1::session'].pendingTokens, 40_000)

  state = applySnapshot(
    state,
    [{ ...baseQuota, usedPercent: 12 }],
    [{ sessionId: 's1', agent: 'claude', title: 'Task A', updatedAt: t3, createdAt: t1 - 100, totalTokens: 150_000 }],
    t3
  )
  assert.equal(state.ledger.length, 1)
  assert.equal(state.ledger[0].deltaTokens, 100_000)
  assert.equal(state.ledger[0].tokensPerPercent, 50_000)

  const weekKey = getIsoWeekKey(t3)
  const monthKey = getMonthKey(t3)
  assert.equal(state.periodStats[`week::${weekKey}::claude::acc-1::session`]?.totalDeltaTokens, 100_000)
  assert.equal(state.periodStats[`month::${monthKey}::claude::acc-1::session`]?.totalDeltaPercent, 2)
})

test('detects weekly/monthly token-per-1% enshittification drop vs baseline', () => {
  const week1 = Date.UTC(2026, 10, 9, 12, 0, 0) // 2026-W46
  const week2 = Date.UTC(2026, 10, 16, 12, 0, 0) // 2026-W47
  const month2 = Date.UTC(2026, 11, 2, 12, 0, 0) // 2026-12

  // Simulate migrating a v1 state with 3 ledger entries across weeks & months
  const migrated = migrateState({
    version: 1,
    lastPollAt: month2,
    lastError: null,
    windows: {},
    ledger: [
      {
        id: '3',
        timestamp: month2,
        provider: 'claude',
        accountId: 'acc-1',
        accountLabel: 'Claude (max_20x)',
        windowId: 'weekly',
        windowLabel: 'Weekly (7d)',
        fromPercent: 10,
        toPercent: 15,
        deltaPercent: 5,
        deltaTokens: 500_000, // 100K / 1% (-33.3% vs baseline 150K)
        tokensPerPercent: 100_000,
        sessionTitles: []
      },
      {
        id: '2',
        timestamp: week2,
        provider: 'claude',
        accountId: 'acc-1',
        accountLabel: 'Claude (max_20x)',
        windowId: 'weekly',
        windowLabel: 'Weekly (7d)',
        fromPercent: 10,
        toPercent: 14,
        deltaPercent: 4,
        deltaTokens: 480_000, // 120K / 1% (-20% vs baseline 150K)
        tokensPerPercent: 120_000,
        sessionTitles: []
      },
      {
        id: '1',
        timestamp: week1,
        provider: 'claude',
        accountId: 'acc-1',
        accountLabel: 'Claude (max_20x)',
        windowId: 'weekly',
        windowLabel: 'Weekly (7d)',
        fromPercent: 10,
        toPercent: 14,
        deltaPercent: 4,
        deltaTokens: 600_000, // 150K / 1% baseline
        tokensPerPercent: 150_000,
        sessionTitles: []
      }
    ],
    sessionTokens: {}
  })

  const view = buildDashboardView(migrated, 15)
  assert.equal(view.weeklySeries.length, 1)
  assert.equal(view.weeklySeries[0].status, 'degraded')
  assert.equal(view.weeklySeries[0].baselineTokensPerPercent, 150_000)
  assert.equal(view.weeklySeries[0].latestTokensPerPercent, 100_000)
  assert.equal(Math.round(view.weeklySeries[0].vsBaselinePercent ?? 0), -33)
  assert.equal(view.monthlySeries.length, 1)
  assert.equal(view.monthlySeries[0].status, 'degraded')
  assert.equal(view.degradedAlerts.length, 2)
})

test('worker refreshes, records % vs tokens, and exports trends CSV', async () => {
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

  try {
    const host = mockHost({
      results: {
        'agent.listSessions': () => ({
          sessions: [
            {
              sessionId: 'sess-1',
              agent: 'claude',
              title: 'Build plugin',
              workspaceId: null,
              hostId: 'local',
              branch: null,
              createdAt: Date.now() - 1000,
              updatedAt: Date.now(),
              messageCount: 4,
              totalTokens: step === 0 ? 100_000 : 340_000,
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
      windows: Array<{ trackedDeltaPercent: number; trackedTokens: number; tokensPerPercent: number }>
      weeklyRows: Array<{ tokensPerPercent: number }>
    }

    assert.equal(view.windows.length, 1)
    assert.equal(view.windows[0].trackedDeltaPercent, 2)
    assert.equal(view.windows[0].trackedTokens, 240_000)
    assert.equal(view.windows[0].tokensPerPercent, 120_000)
    assert.equal(view.weeklyRows.length, 1)
    assert.equal(view.weeklyRows[0].tokensPerPercent, 120_000)

    const csvRes = (await worker.request('tracker.exportTrendsCsv', {
      granularity: 'week'
    })) as unknown as { filename: string; csv: string }
    assert.ok(csvRes.filename.includes('week'))
    assert.ok(csvRes.csv.includes('120000'))
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    main.setAccountListFetcherForTests(null)
  }
})
