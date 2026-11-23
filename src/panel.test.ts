import { createRequire } from 'node:module'
import { assert, test } from 'orca/testing'
import { buildDashboardView, createEmptyState, type DashboardView } from './model'

const require = createRequire(import.meta.url)
const renderApi = require('../panel/render.js') as {
  escapeHtml: (v: unknown) => string
  renderApp: (view: DashboardView | null, uiState: Record<string, unknown>, nowMs?: number) => string
  renderTrendChartSvg: (
    series: Record<string, unknown>,
    selectedIndex?: number,
    nerfDropPercent?: number
  ) => string
}

function makeSampleView(): DashboardView {
  const now = Date.UTC(2026, 10, 23, 6, 0, 0)
  const w1 = Date.UTC(2026, 10, 9, 12, 0, 0)
  const w2 = Date.UTC(2026, 10, 16, 12, 0, 0)

  const state = createEmptyState()
  state.lastPollAt = now
  state.windows['claude::acc-1::weekly'] = {
    key: 'claude::acc-1::weekly',
    provider: 'claude',
    accountId: 'acc-1',
    accountLabel: 'Claude <script>alert(1)</script>',
    planType: 'max_20x',
    isActiveAccount: true,
    windowId: 'weekly',
    windowLabel: 'Weekly (7d)',
    windowMinutes: 10080,
    resetsAt: now + 2 * 86_400_000,
    resetDescription: 'Thu 9:00 PM',
    baselinePercent: 18,
    currentPercent: 21,
    trackedDeltaPercent: 3,
    trackedTokens: 360_000,
    pendingTokens: 0,
    trackedCostUsd: 4.5,
    pendingCostUsd: 0,
    trackedModels: {
      'claude-opus-5-5': {
        inputTokens: 10_000,
        outputTokens: 60_000,
        cacheWrite5mTokens: 50_000,
        cacheWrite1hTokens: 0,
        cacheReadTokens: 100_000,
        totalTokens: 220_000,
        costUsd: 3.2
      }
    },
    pendingModels: {},
    firstSeenAt: now - 3_600_000,
    lastUpdatedAt: now
  }
  state.periodStats = {
    'week::2026-W46::claude::acc-1::weekly': {
      key: 'week::2026-W46::claude::acc-1::weekly',
      periodType: 'week',
      periodKey: '2026-W46',
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      totalDeltaPercent: 10,
      totalDeltaTokens: 1_500_000,
      totalDeltaCostUsd: 20,
      models: {},
      sampleCount: 5,
      firstTimestamp: w1,
      lastTimestamp: w1
    },
    'week::2026-W47::claude::acc-1::weekly': {
      key: 'week::2026-W47::claude::acc-1::weekly',
      periodType: 'week',
      periodKey: '2026-W47',
      provider: 'claude',
      accountId: 'acc-1',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      totalDeltaPercent: 8,
      totalDeltaTokens: 960_000,
      totalDeltaCostUsd: 12,
      models: {},
      sampleCount: 4,
      firstTimestamp: w2,
      lastTimestamp: w2
    }
  }
  return buildDashboardView(state, 15, now)
}

test('panel renderer escapes untrusted strings and renders overview, SVG trends, and ledger safely', () => {
  const view = makeSampleView()
  const baseUi = {
    activeTab: 'overview',
    granularity: 'week',
    providerFilter: 'all',
    showAllLedger: false,
    ledgerLimit: 40,
    refreshing: false,
    confirmReset: false,
    notice: null,
    expandedIdleAccounts: {},
    expandedLedgerIds: {},
    selectedChartPoint: {}
  }

  const overviewHtml = renderApi.renderApp(view, baseUi, view.lastPollAt ?? undefined)
  assert.ok(!overviewHtml.includes('<script>alert(1)</script>'))
  assert.ok(overviewHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(overviewHtml.includes('stacked-bar'))
  assert.ok(overviewHtml.includes('추정 월 가치 하락 의심'))

  const trendsHtml = renderApi.renderApp(
    view,
    { ...baseUi, activeTab: 'trends' },
    view.lastPollAt ?? undefined
  )
  assert.ok(trendsHtml.includes('<svg class="trend-svg"'))
  assert.ok(trendsHtml.includes('W46'))
  assert.ok(trendsHtml.includes('W47'))

  const emptyHtml = renderApi.renderApp(
    buildDashboardView(createEmptyState(), 15),
    baseUi,
    Date.now()
  )
  assert.ok(emptyHtml.includes('추적 중인 계정이 없습니다'))
})
