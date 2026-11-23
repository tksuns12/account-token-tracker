import { assert, mockHost, mount, test } from 'orca/testing'
import type { DashboardView } from './model'
import * as panel from './panel'

const mockView: DashboardView = {
  lastPollAt: 1795156500000,
  lastError: null,
  nerfAlertDropPercent: 15,
  statusBarText: 'Claude 21% · $1.50/1% ⚠',
  statusBarTooltip: 'Claude (max_20x)',
  statusBarTone: 'danger',
  windows: [
    {
      key: 'claude::claude:system::weekly',
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      planType: 'max_20x',
      isActiveAccount: true,
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      resetsAt: 1795694400308,
      resetDescription: 'Thu 9:00 PM',
      baselinePercent: 18,
      currentPercent: 21,
      trackedDeltaPercent: 3,
      trackedTokens: 360_000,
      pendingTokens: 0,
      trackedCostUsd: 4.5,
      pendingCostUsd: 0,
      trackedModels: {},
      pendingModels: {},
      firstSeenAt: 1795150000000,
      lastUpdatedAt: 1795156500000,
      tokensPerPercent: 120_000,
      estimated100PercentTokens: 12_000_000,
      usdPerPercent: 1.5,
      estimated100PercentUsd: 150,
      modelBreakdown: [
        {
          model: 'claude-opus-5-5',
          shortName: 'opus-5-5',
          costUsd: 3.2,
          totalTokens: 220_000,
          inputTokens: 10_000,
          outputTokens: 60_000,
          cacheReadTokens: 100_000,
          cacheWriteTokens: 50_000,
          sharePercent: 71.1
        }
      ]
    }
  ],
  ledger: [
    {
      id: 'entry-1',
      timestamp: 1795156500000,
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      fromPercent: 18,
      toPercent: 21,
      deltaPercent: 3,
      deltaTokens: 360_000,
      tokensPerPercent: 120_000,
      deltaCostUsd: 4.5,
      usdPerPercent: 1.5,
      models: {},
      sessionTitles: ['Build plugin']
    }
  ],
  weeklySeries: [
    {
      seriesKey: 'claude::claude:system::weekly',
      periodType: 'week',
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      periodCount: 2,
      baselinePeriodKey: '2026-W46',
      baselineTokensPerPercent: 150_000,
      baselineUsdPerPercent: 2.0,
      latestPeriodKey: '2026-W47',
      latestTokensPerPercent: 120_000,
      latestUsdPerPercent: 1.5,
      latestDeltaPercent: 8,
      previousTokensPerPercent: 150_000,
      previousUsdPerPercent: 2.0,
      vsBaselinePercent: -25,
      vsPreviousPercent: -25,
      metricKind: 'usd',
      status: 'degraded'
    }
  ],
  weeklyRows: [
    {
      key: 'week::2026-W47::claude::claude:system::weekly',
      periodType: 'week',
      periodKey: '2026-W47',
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      totalDeltaPercent: 8,
      totalDeltaTokens: 960_000,
      totalDeltaCostUsd: 12.0,
      tokensPerPercent: 120_000,
      estimated100PercentTokens: 12_000_000,
      usdPerPercent: 1.5,
      estimated100PercentUsd: 150,
      topModelsSummary: 'opus-5-5 $12.00',
      sampleCount: 4,
      prevChangePercent: -25,
      baselineChangePercent: -25,
      bar: '████████░░'
    }
  ],
  monthlySeries: [],
  monthlyRows: [],
  degradedAlerts: [
    {
      seriesKey: 'claude::claude:system::weekly',
      periodType: 'week',
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      periodCount: 2,
      baselinePeriodKey: '2026-W46',
      baselineTokensPerPercent: 150_000,
      baselineUsdPerPercent: 2.0,
      latestPeriodKey: '2026-W47',
      latestTokensPerPercent: 120_000,
      latestUsdPerPercent: 1.5,
      latestDeltaPercent: 8,
      previousTokensPerPercent: 150_000,
      previousUsdPerPercent: 2.0,
      vsBaselinePercent: -25,
      vsPreviousPercent: -25,
      metricKind: 'usd',
      status: 'degraded'
    }
  ]
}

test('renders USD/1% value, model breakdown, enshittification alert, and refresh', async () => {
  let refreshed = false
  const host = mockHost({
    requests: {
      'tracker.get': () => mockView as unknown as Record<string, never>,
      'tracker.refresh': () => {
        refreshed = true
        return mockView as unknown as Record<string, never>
      }
    }
  })

  const view = await mount(panel, { host })
  assert.ok(view.find({ text: /21% 사용/ }))
  assert.ok(view.find({ type: 'Callout' }))
  const kv = view.find({ type: 'KeyValue' })
  assert.ok(kv)
  const items = kv.props.items as Array<{ label: string; value: string }>
  assert.equal(items.find((i) => i.label === '1%당 달러 가치')?.value, '$1.50 / 1%')
  assert.equal(items.find((i) => i.label === '100% 추정 가치')?.value, '약 $150')

  await view.press({ text: '지금 측정' })
  assert.equal(refreshed, true)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
