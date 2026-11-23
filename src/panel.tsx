import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  Collapsible,
  EmptyState,
  files,
  Heading,
  KeyValue,
  plugin,
  Progress,
  RadioGroup,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  Stack,
  Tab,
  Table,
  Tabs,
  Text,
  type PanelContext,
  type TableColumn,
  type TableRow
} from 'orca'
import {
  formatProviderName,
  formatSignedPercent,
  formatTokens,
  formatUsd,
  summarizeTopModels,
  type DashboardView,
  type DriftStatus,
  type LedgerEntry,
  type PeriodGranularity,
  type TrendPeriodRow,
  type TrendSeriesSummary,
  type WindowSummaryView
} from './model'

const dashboard = atom<DashboardView | null>(null)
const refreshing = atom(false)
const activeTab = atom('activeTab', 'overview', { persist: 'plugin' })
const trendGranularity = atom<PeriodGranularity>('trendGranularity', 'week', { persist: 'plugin' })
const providerFilter = atom('providerFilter', 'all', { persist: 'plugin' })
const confirmReset = atom(false)
const notice = atom<string | null>(null)

async function loadInitial(): Promise<void> {
  const view = (await plugin.request('tracker.get')) as unknown as DashboardView
  set(dashboard, view)
}

async function refreshNow(): Promise<void> {
  if (read(refreshing)) return
  set(refreshing, true)
  set(notice, null)
  try {
    const view = (await plugin.request('tracker.refresh')) as unknown as DashboardView
    set(dashboard, view)
  } catch (err) {
    set(notice, err instanceof Error ? err.message : String(err))
  } finally {
    set(refreshing, false)
  }
}

async function exportCsv(): Promise<void> {
  try {
    const tab = read(activeTab)
    const result =
      tab === 'trends'
        ? ((await plugin.request('tracker.exportTrendsCsv', {
            granularity: read(trendGranularity)
          })) as unknown as { filename: string; csv: string })
        : ((await plugin.request('tracker.exportCsv')) as unknown as {
            filename: string
            csv: string
          })

    const res = await files.saveAs({
      suggestedName: result.filename,
      mimeType: 'text/csv;charset=utf-8',
      data: result.csv
    })
    if (res.status === 'saved') {
      set(notice, `${result.filename} 저장 완료`)
    }
  } catch (err) {
    set(notice, err instanceof Error ? err.message : String(err))
  }
}

async function resetHistory(): Promise<void> {
  if (!read(confirmReset)) {
    set(confirmReset, true)
    return
  }
  set(confirmReset, false)
  const view = (await plugin.request('tracker.reset')) as unknown as DashboardView
  set(dashboard, view)
  set(notice, '추적 기록 및 주간/월간 추이를 초기화했습니다.')
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('tracker.updated', (payload) => {
      set(dashboard, payload as unknown as DashboardView)
    })
  )
  void loadInitial()
}

function percentTone(pct: number): 'neutral' | 'accent' | 'warning' | 'danger' {
  if (pct >= 90) return 'danger'
  if (pct >= 75) return 'warning'
  if (pct > 0) return 'accent'
  return 'neutral'
}

function driftBadge(status: DriftStatus): {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
} {
  switch (status) {
    case 'degraded':
      return { label: '가치 하락 의심', tone: 'danger' }
    case 'watch':
      return { label: '하락 주의', tone: 'warning' }
    case 'stable':
      return { label: '안정', tone: 'success' }
    default:
      return { label: '기준 수집 중', tone: 'neutral' }
  }
}

function WindowCard(w: WindowSummaryView) {
  const deltaText =
    w.trackedDeltaPercent > 0
      ? `+${w.trackedDeltaPercent}% (${w.baselinePercent}% → ${w.currentPercent}%)`
      : `0% (기준 ${w.baselinePercent}%)`

  const spentText =
    w.trackedCostUsd > 0
      ? `${formatUsd(w.trackedCostUsd)} (${formatTokens(w.trackedTokens)} tok)`
      : `${formatTokens(w.trackedTokens)} tok`

  const resetText = w.resetDescription
    ? w.resetDescription
    : w.resetsAt
      ? new Date(w.resetsAt).toLocaleString()
      : '-'

  return (
    <Card
      key={w.key}
      title={`${w.accountLabel} · ${w.windowLabel}`}
      description={
        w.planType
          ? `${formatProviderName(w.provider)} · ${w.planType}`
          : formatProviderName(w.provider)
      }
    >
      <Stack gap="sm">
        <Row justify="between" align="center">
          <Row gap="xs" align="center">
            <Badge tone={percentTone(w.currentPercent)}>{`${w.currentPercent}% 사용`}</Badge>
            {w.isActiveAccount ? <Badge tone="success">활성</Badge> : <Badge tone="neutral">비활성</Badge>}
          </Row>
          <Text muted size="xs">
            리셋: {resetText}
          </Text>
        </Row>
        <Progress label={`${w.windowLabel} usage`} labelHidden value={w.currentPercent} />
        <KeyValue
          items={[
            { label: '추적 구간 Δ%', value: deltaText },
            { label: '누적 사용량', value: spentText, tone: w.trackedCostUsd > 0 ? 'accent' : 'neutral' }
          ]}
        />
        {w.modelBreakdown.length > 0 ? (
          <Collapsible
            title={`모델별 사용 내역 (${w.modelBreakdown.length})`}
            defaultOpen={w.modelBreakdown.length <= 3}
          >
            <KeyValue
              items={w.modelBreakdown.map((m) => ({
                label: m.shortName,
                value: `${formatUsd(m.costUsd)} (${Math.round(m.sharePercent)}%) · ${formatTokens(m.totalTokens)} tok`,
                code: true
              }))}
            />
          </Collapsible>
        ) : null}
      </Stack>
    </Card>
  )
}

function TrendSeriesCard(s: TrendSeriesSummary) {
  const badge = driftBadge(s.status)
  const prevLabel = s.periodType === 'week' ? '전주 대비' : '전월 대비'
  const baseTone =
    s.vsBaselinePercent === null
      ? 'neutral'
      : s.status === 'degraded'
        ? 'danger'
        : s.status === 'watch'
          ? 'warning'
          : 'success'

  const fmtMonthly = (monthlyUsd: number, tokPerPct: number) =>
    s.metricKind === 'usd'
      ? `약 ${formatUsd(monthlyUsd)} / 월`
      : `${formatTokens(tokPerPct)} tok / 1%`

  return (
    <Card
      key={`${s.periodType}-${s.seriesKey}`}
      title={`${s.accountLabel} · ${s.windowLabel}`}
      description={`${s.periodCount}개 ${s.periodType === 'week' ? '주' : '월'} 누적 (${s.baselinePeriodKey} ~ ${s.latestPeriodKey})`}
    >
      <Stack gap="sm">
        <Row justify="between" align="center">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <Text muted size="xs">
            최근 구간: {s.latestPeriodKey} (Δ{s.latestDeltaPercent}%)
          </Text>
        </Row>
        <KeyValue
          items={[
            {
              label: `기준 (${s.baselinePeriodKey})`,
              value: fmtMonthly(s.baselineMonthlyUsd, s.baselineTokensPerPercent),
              code: true
            },
            {
              label: `최근 (${s.latestPeriodKey})`,
              value: fmtMonthly(s.latestMonthlyUsd, s.latestTokensPerPercent),
              tone: baseTone,
              code: true
            },
            {
              label: '기준 대비 월 가치 변화',
              value: formatSignedPercent(s.vsBaselinePercent),
              tone: baseTone
            },
            {
              label: prevLabel,
              value: formatSignedPercent(s.vsPreviousPercent),
              tone:
                s.vsPreviousPercent !== null && s.vsPreviousPercent < 0 ? 'warning' : 'neutral'
            }
          ]}
        />
      </Stack>
    </Card>
  )
}

const TREND_COLUMNS: readonly TableColumn[] = [
  { key: 'period', label: '기간', width: 'sm' },
  { key: 'account', label: '계정 · 윈도우', width: 'md' },
  { key: 'delta', label: 'Δ%', align: 'end', width: 'xs' },
  { key: 'monthlyUsd', label: '추정 월 가치', align: 'end', width: 'sm' },
  { key: 'prevDiff', label: '전기간', align: 'end', width: 'xs', hideBelow: 'sm' },
  { key: 'baseDiff', label: '기준대비', align: 'end', width: 'sm' },
  { key: 'bar', label: '추이', width: 'sm', hideBelow: 'md' }
]

function toTrendRows(entries: TrendPeriodRow[]): TableRow[] {
  return entries.map((r) => ({
    key: r.key,
    cells: {
      period: r.periodKey,
      account: `${r.accountLabel} · ${r.windowLabel}`,
      delta: `+${r.totalDeltaPercent}%`,
      monthlyUsd:
        r.estimatedMonthlyUsd > 0
          ? `${formatUsd(r.estimatedMonthlyUsd)}/월`
          : `${formatTokens(r.tokensPerPercent)} tok`,
      prevDiff: formatSignedPercent(r.prevChangePercent),
      baseDiff: formatSignedPercent(r.baselineChangePercent),
      bar: r.bar
    }
  }))
}

const LEDGER_COLUMNS: readonly TableColumn[] = [
  { key: 'time', label: '시각', width: 'sm' },
  { key: 'account', label: '계정', width: 'md' },
  { key: 'pct', label: '% 변화', width: 'md' },
  { key: 'usd', label: '$ 가치', align: 'end', width: 'sm' },
  { key: 'usdPerPct', label: '$/1%', align: 'end', width: 'sm' },
  { key: 'models', label: '사용 모델', width: 'md', hideBelow: 'sm' }
]

function toLedgerRows(entries: LedgerEntry[]): TableRow[] {
  return entries.map((e) => ({
    key: e.id,
    cells: {
      time: { type: 'relative', at: e.timestamp, format: 'short' },
      account: `${e.accountLabel} (${e.windowLabel})`,
      pct: `${e.fromPercent}% → ${e.toPercent}% (+${e.deltaPercent}%)`,
      usd: e.deltaCostUsd > 0 ? formatUsd(e.deltaCostUsd) : `+${formatTokens(e.deltaTokens)} tok`,
      usdPerPct: e.usdPerPercent > 0 ? formatUsd(e.usdPerPercent) : `${formatTokens(e.tokensPerPercent)}`,
      models: summarizeTopModels(e.models, 2)
    }
  }))
}

export default function Panel() {
  const view = read(dashboard)
  const isBusy = read(refreshing)
  const tab = read(activeTab)
  const granularity = read(trendGranularity)
  const selectedProvider = read(providerFilter)
  const isConfirmingReset = read(confirmReset)
  const msg = read(notice)

  const providers = Array.from(
    new Set([
      ...(view?.windows ?? []).map((w) => w.provider),
      ...(view?.weeklySeries ?? []).map((s) => s.provider),
      ...(view?.monthlySeries ?? []).map((s) => s.provider)
    ])
  ).sort()

  const filterOptions = [
    { value: 'all', label: '전체 계정 / 프로바이더' },
    ...providers.map((p) => ({ value: p, label: formatProviderName(p) }))
  ]

  const matchProvider = (p: string) => selectedProvider === 'all' || p === selectedProvider

  const filteredWindows = (view?.windows ?? []).filter((w) => matchProvider(w.provider))
  const filteredLedger = (view?.ledger ?? []).filter((e) => matchProvider(e.provider))
  const activeSeries = (
    granularity === 'month' ? view?.monthlySeries ?? [] : view?.weeklySeries ?? []
  ).filter((s) => matchProvider(s.provider))
  const activeTrendRows = (
    granularity === 'month' ? view?.monthlyRows ?? [] : view?.weeklyRows ?? []
  ).filter((r) => matchProvider(r.provider))
  const activeAlerts = (view?.degradedAlerts ?? []).filter((a) => matchProvider(a.provider))

  const canExport =
    tab === 'trends' ? activeTrendRows.length > 0 : (view?.ledger.length ?? 0) > 0

  return (
    <Stack gap="md">
      <Row justify="between" align="center" wrap>
        <Stack gap="none">
          <Heading level={2}>Account Token Tracker</Heading>
          {view?.lastPollAt ? (
            <Text muted size="xs">
              최근 기록 <RelativeTime at={view.lastPollAt} format="short" />
            </Text>
          ) : (
            <Text muted size="xs">
              아직 스냅샷이 기록되지 않았습니다
            </Text>
          )}
        </Stack>
        <Row gap="xs">
          <Button size="sm" icon="refresh" disabled={isBusy} onPress={refreshNow}>
            {isBusy ? '수집 중...' : '지금 측정'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon="download"
            disabled={!canExport}
            onPress={exportCsv}
          >
            CSV
          </Button>
        </Row>
      </Row>

      {activeAlerts.length > 0 ? (
        <Callout tone="danger" title="추정 월 가치 하락 (Enshittification) 의심" icon="warning">
          <Stack gap="xs">
            {activeAlerts.map((a) => (
              <Text key={`${a.periodType}-${a.seriesKey}`} size="xs">
                {a.metricKind === 'usd'
                  ? `${a.accountLabel} (${a.windowLabel}, ${a.periodType === 'week' ? '주간' : '월간'}): 추정 월 가치 ${formatUsd(a.baselineMonthlyUsd)}/월 → ${formatUsd(a.latestMonthlyUsd)}/월 (${formatSignedPercent(a.vsBaselinePercent)})`
                  : `${a.accountLabel} (${a.windowLabel}, ${a.periodType === 'week' ? '주간' : '월간'}): 1%당 ${formatTokens(a.baselineTokensPerPercent)} → ${formatTokens(a.latestTokensPerPercent)} (${formatSignedPercent(a.vsBaselinePercent)})`}
              </Text>
            ))}
          </Stack>
        </Callout>
      ) : null}

      {view?.lastError ? (
        <Callout tone="warning" title="스냅샷 수집 오류" icon="warning">
          <Text size="xs">{view.lastError}</Text>
        </Callout>
      ) : null}

      {msg ? (
        <Callout tone="accent" icon="info">
          <Text size="xs">{msg}</Text>
        </Callout>
      ) : null}

      {providers.length > 1 ? (
        <Select
          label="프로바이더 필터"
          labelHidden
          value={selectedProvider}
          options={filterOptions}
          onChange={(v) => set(providerFilter, v)}
        />
      ) : null}

      <Tabs label="Token tracker views" value={tab} onChange={(v) => set(activeTab, v)}>
        <Tab value="overview" label={`계정별 현황 (${filteredWindows.length})`} icon="gauge">
          <Stack gap="sm">
            {filteredWindows.length === 0 ? (
              <EmptyState
                title="추적 중인 계정이 없습니다"
                description="지금 측정 버튼을 눌러 Orca 계정 사용률(%)과 모델별 달러 환산 기준점을 기록하세요."
                icon="bar-chart-3"
              />
            ) : (
              filteredWindows.map((w) => WindowCard(w))
            )}
          </Stack>
        </Tab>

        <Tab value="trends" label={`주간/월간 추이 (${activeSeries.length})`} icon="bar-chart-3">
          <Stack gap="sm">
            <Row justify="between" align="center" wrap>
              <RadioGroup
                label="집계 단위"
                labelHidden
                orientation="horizontal"
                value={granularity}
                options={[
                  { value: 'week', label: '주간 (Weekly)' },
                  { value: 'month', label: '월간 (Monthly)' }
                ]}
                onChange={(v) => set(trendGranularity, v as PeriodGranularity)}
              />
              <Text muted size="xs">
                경고 기준: 추정 월 가치 -{view?.nerfAlertDropPercent ?? 15}% 이하
              </Text>
            </Row>

            {activeSeries.length === 0 ? (
              <EmptyState
                title="주간/월간 추이 데이터가 아직 없습니다"
                description="쿼터 %가 1% 이상 상승한 기록이 쌓이면 모델별 API 단가 기준 추정 한 달치 달러 가치($/월) 변화와 하락률을 자동으로 감시합니다."
                icon="bar-chart-3"
              />
            ) : (
              <Stack gap="sm">
                {activeSeries.map((s) => TrendSeriesCard(s))}
                <Table
                  label="Weekly and monthly estimated monthly USD history"
                  columns={TREND_COLUMNS}
                  rows={toTrendRows(activeTrendRows)}
                  maxHeight="lg"
                  emptyText="집계 데이터 없음"
                />
              </Stack>
            )}
          </Stack>
        </Tab>

        <Tab value="ledger" label={`% 변화 기록 (${filteredLedger.length})`} icon="activity">
          <Stack gap="sm">
            {filteredLedger.length === 0 ? (
              <EmptyState
                title="아직 % 변화 기록이 없습니다"
                description="에이전트를 사용해서 쿼터 %가 1% 이상 오르면 모델별 사용량과 $/1% 환산 가치가 자동으로 기록됩니다."
                icon="activity"
              />
            ) : (
              <Table
                label="Quota percentage jump ledger"
                columns={LEDGER_COLUMNS}
                rows={toLedgerRows(filteredLedger)}
                maxHeight="lg"
                emptyText="기록 없음"
              />
            )}
          </Stack>
        </Tab>
      </Tabs>

      <Row justify="between" align="center">
        <Text muted size="xs">
          모델 단가는 설정(customPricingJson)에서 수정 가능
        </Text>
        <Row gap="xs">
          {isConfirmingReset ? (
            <Button size="xs" variant="ghost" onPress={() => set(confirmReset, false)}>
              취소
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            tone={isConfirmingReset ? 'danger' : 'neutral'}
            icon="delete"
            onPress={resetHistory}
          >
            {isConfirmingReset ? '정말 초기화' : '기록 초기화'}
          </Button>
        </Row>
      </Row>
    </Stack>
  )
}
