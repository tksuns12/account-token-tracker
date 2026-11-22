import { assert, mockHost, mount, test } from 'orca/testing'
import type { DashboardView } from './model'
import * as panel from './panel'

const mockView: DashboardView = {
  lastPollAt: 1795156500000,
  lastError: null,
  nerfAlertDropPercent: 15,
  statusBarText: 'Claude 21% · 120.0K/1% ⚠',
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
      firstSeenAt: 1795150000000,
      lastUpdatedAt: 1795156500000,
      tokensPerPercent: 120_000,
      estimated100PercentTokens: 12_000_000
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
      latestPeriodKey: '2026-W47',
      latestTokensPerPercent: 120_000,
      latestDeltaPercent: 8,
      previousTokensPerPercent: 150_000,
      vsBaselinePercent: -20,
      vsPreviousPercent: -20,
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
      tokensPerPercent: 120_000,
      estimated100PercentTokens: 12_000_000,
      sampleCount: 4,
      prevChangePercent: -20,
      baselineChangePercent: -20,
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
      latestPeriodKey: '2026-W47',
      latestTokensPerPercent: 120_000,
      latestDeltaPercent: 8,
      previousTokensPerPercent: 150_000,
      vsBaselinePercent: -20,
      vsPreviousPercent: -20,
      status: 'degraded'
    }
  ]
}

test('renders enshittification alert, account card, and weekly/monthly trends tab', async () => {
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
  assert.equal(items.find((i) => i.label === '1%당 환산 토큰')?.value, '120.0K tok / 1%')

  await view.press({ text: '지금 측정' })
  assert.equal(refreshed, true)
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
