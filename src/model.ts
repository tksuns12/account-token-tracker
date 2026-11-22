export interface SessionRecord {
  sessionId: string
  agent: string
  title: string
  updatedAt: number
  createdAt: number | null
  totalTokens: number
}

export interface QuotaWindowSample {
  provider: string
  accountId: string
  accountLabel: string
  planType: string | null
  isActiveAccount: boolean
  windowId: string
  windowLabel: string
  windowMinutes: number | null
  usedPercent: number
  resetsAt: number | null
  resetDescription: string | null
}

export interface WindowTracker {
  key: string
  provider: string
  accountId: string
  accountLabel: string
  planType: string | null
  isActiveAccount: boolean
  windowId: string
  windowLabel: string
  windowMinutes: number | null
  resetsAt: number | null
  resetDescription: string | null
  baselinePercent: number
  currentPercent: number
  trackedDeltaPercent: number
  trackedTokens: number
  pendingTokens: number
  firstSeenAt: number
  lastUpdatedAt: number
}

export interface LedgerEntry {
  id: string
  timestamp: number
  provider: string
  accountId: string
  accountLabel: string
  windowId: string
  windowLabel: string
  fromPercent: number
  toPercent: number
  deltaPercent: number
  deltaTokens: number
  tokensPerPercent: number
  sessionTitles: string[]
}

export type PeriodGranularity = 'week' | 'month'

export interface PeriodStat {
  key: string
  periodType: PeriodGranularity
  periodKey: string // e.g. '2026-W47' or '2026-11'
  provider: string
  accountId: string
  accountLabel: string
  windowId: string
  windowLabel: string
  totalDeltaPercent: number
  totalDeltaTokens: number
  sampleCount: number
  firstTimestamp: number
  lastTimestamp: number
}

export interface StoredSessionBaseline {
  agent: string
  totalTokens: number
  updatedAt: number
}

export interface TrackerState {
  version: 2
  lastPollAt: number | null
  lastError: string | null
  windows: Record<string, WindowTracker>
  ledger: LedgerEntry[]
  periodStats: Record<string, PeriodStat>
  sessionTokens: Record<string, StoredSessionBaseline>
}

export interface WindowSummaryView extends WindowTracker {
  tokensPerPercent: number | null
  estimated100PercentTokens: number | null
}

export type DriftStatus = 'collecting' | 'stable' | 'watch' | 'degraded'

export interface TrendPeriodRow {
  key: string
  periodType: PeriodGranularity
  periodKey: string
  provider: string
  accountId: string
  accountLabel: string
  windowId: string
  windowLabel: string
  totalDeltaPercent: number
  totalDeltaTokens: number
  tokensPerPercent: number
  estimated100PercentTokens: number
  sampleCount: number
  prevChangePercent: number | null
  baselineChangePercent: number | null
  bar: string
}

export interface TrendSeriesSummary {
  seriesKey: string
  periodType: PeriodGranularity
  provider: string
  accountId: string
  accountLabel: string
  windowId: string
  windowLabel: string
  periodCount: number
  baselinePeriodKey: string
  baselineTokensPerPercent: number
  latestPeriodKey: string
  latestTokensPerPercent: number
  latestDeltaPercent: number
  previousTokensPerPercent: number | null
  vsBaselinePercent: number | null
  vsPreviousPercent: number | null
  status: DriftStatus
}

export interface DashboardView {
  lastPollAt: number | null
  lastError: string | null
  nerfAlertDropPercent: number
  windows: WindowSummaryView[]
  ledger: LedgerEntry[]
  weeklySeries: TrendSeriesSummary[]
  weeklyRows: TrendPeriodRow[]
  monthlySeries: TrendSeriesSummary[]
  monthlyRows: TrendPeriodRow[]
  degradedAlerts: TrendSeriesSummary[]
  statusBarText: string
  statusBarTooltip: string
  statusBarTone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
}

export function createEmptyState(): TrackerState {
  return {
    version: 2,
    lastPollAt: null,
    lastError: null,
    windows: {},
    ledger: [],
    periodStats: {},
    sessionTokens: {}
  }
}

/** Formats a UTC timestamp into an ISO-8601 week key such as `2026-W47`. */
export function getIsoWeekKey(timestampMs: number): string {
  const d = new Date(timestampMs)
  // Shift to Thursday of the same ISO week (UTC)
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/** Formats a UTC timestamp into a month key such as `2026-11`. */
export function getMonthKey(timestampMs: number): string {
  const d = new Date(timestampMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function recordPeriodRollup(
  periodStats: Record<string, PeriodStat>,
  entry: LedgerEntry,
  periodType: PeriodGranularity
): void {
  if (entry.deltaPercent <= 0) return
  const periodKey =
    periodType === 'week' ? getIsoWeekKey(entry.timestamp) : getMonthKey(entry.timestamp)
  const key = `${periodType}::${periodKey}::${entry.provider}::${entry.accountId}::${entry.windowId}`
  const existing = periodStats[key]

  if (!existing) {
    periodStats[key] = {
      key,
      periodType,
      periodKey,
      provider: entry.provider,
      accountId: entry.accountId,
      accountLabel: entry.accountLabel,
      windowId: entry.windowId,
      windowLabel: entry.windowLabel,
      totalDeltaPercent: entry.deltaPercent,
      totalDeltaTokens: entry.deltaTokens,
      sampleCount: 1,
      firstTimestamp: entry.timestamp,
      lastTimestamp: entry.timestamp
    }
  } else {
    periodStats[key] = {
      ...existing,
      accountLabel: entry.accountLabel,
      windowLabel: entry.windowLabel,
      totalDeltaPercent: existing.totalDeltaPercent + entry.deltaPercent,
      totalDeltaTokens: existing.totalDeltaTokens + entry.deltaTokens,
      sampleCount: existing.sampleCount + 1,
      firstTimestamp: Math.min(existing.firstTimestamp, entry.timestamp),
      lastTimestamp: Math.max(existing.lastTimestamp, entry.timestamp)
    }
  }
}

/** Upgrades a v1 or partial persisted state to v2, backfilling periodStats from ledger if needed. */
export function migrateState(raw: unknown): TrackerState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createEmptyState()
  }
  const obj = raw as Partial<TrackerState> & { version?: number }
  if (obj.version !== 1 && obj.version !== 2) {
    return createEmptyState()
  }

  const ledger = Array.isArray(obj.ledger) ? obj.ledger : []
  const periodStats: Record<string, PeriodStat> =
    obj.version === 2 && obj.periodStats && typeof obj.periodStats === 'object'
      ? { ...obj.periodStats }
      : {}

  // Backfill periodStats from existing v1 ledger entries
  if (obj.version === 1 || Object.keys(periodStats).length === 0) {
    for (const entry of ledger) {
      recordPeriodRollup(periodStats, entry, 'week')
      recordPeriodRollup(periodStats, entry, 'month')
    }
  }

  return {
    version: 2,
    lastPollAt: typeof obj.lastPollAt === 'number' ? obj.lastPollAt : null,
    lastError: typeof obj.lastError === 'string' ? obj.lastError : null,
    windows: obj.windows && typeof obj.windows === 'object' ? obj.windows : {},
    ledger,
    periodStats,
    sessionTokens:
      obj.sessionTokens && typeof obj.sessionTokens === 'object' ? obj.sessionTokens : {}
  }
}

export function normalizeAgentToProvider(agent: string): string {
  const key = agent.toLowerCase()
  if (key === 'claude' || key === 'claude-code') return 'claude'
  if (key === 'codex') return 'codex'
  if (key === 'gemini') return 'gemini'
  if (key === 'antigravity') return 'antigravity'
  if (key === 'opencode' || key === 'opencode2' || key === 'opencode-go') return 'opencodeGo'
  if (key === 'kimi') return 'kimi'
  if (key === 'cursor') return 'cursor'
  if (key === 'grok') return 'grok'
  if (key === 'minimax') return 'minimax'
  if (key === 'zcode') return 'zcode'
  if (key === 'muse') return 'muse'
  return key
}

export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return '-'
  const abs = Math.abs(tokens)
  if (abs >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${Math.round(tokens)}`
}

export function formatSignedPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '-'
  const rounded = Math.round(pct * 10) / 10
  if (rounded > 0) return `+${rounded.toFixed(1)}%`
  return `${rounded.toFixed(1)}%`
}

export function formatProviderName(provider: string): string {
  switch (provider) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    case 'antigravity':
      return 'Antigravity'
    case 'gemini':
      return 'Gemini'
    case 'opencodeGo':
      return 'OpenCode Go'
    case 'kimi':
      return 'Kimi'
    case 'cursor':
      return 'Cursor'
    case 'grok':
      return 'Grok'
    case 'minimax':
      return 'MiniMax'
    case 'zcode':
      return 'ZCode'
    case 'muse':
      return 'Muse'
    default:
      return provider
  }
}

type RawWindow = {
  usedPercent?: unknown
  windowMinutes?: unknown
  resetsAt?: unknown
  resetDescription?: unknown
}

type RawBucket = RawWindow & {
  name?: unknown
  group?: unknown
  windowName?: unknown
}

type RawAccount = {
  id?: unknown
  accountId?: unknown
  email?: unknown
  label?: unknown
  name?: unknown
  workspaceLabel?: unknown
  planType?: unknown
  rateLimit?: Record<string, unknown>
  usage?: Record<string, unknown>
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function resolveAccountIdentity(
  provider: string,
  resultObj: Record<string, unknown>,
  rlObj: Record<string, unknown>
): { accountId: string; accountLabel: string; planType: string | null } {
  const providerSection = asRecord(resultObj[provider])
  const planType = asString(rlObj.planType)
  const activeId =
    asString(providerSection?.activeAccountId) ?? asString(providerSection?.selectedAccountId)
  const accounts = Array.isArray(providerSection?.accounts)
    ? (providerSection.accounts as RawAccount[])
    : []

  if (activeId) {
    const matched = accounts.find(
      (a) => asString(a.id) === activeId || asString(a.accountId) === activeId
    )
    const label =
      asString(matched?.label) ??
      asString(matched?.email) ??
      asString(matched?.name) ??
      asString(matched?.workspaceLabel) ??
      activeId
    return { accountId: activeId, accountLabel: label, planType }
  }

  const sysDefault = asRecord(providerSection?.systemDefault)
  const currentAcc = asRecord(providerSection?.currentAccount)
  const email = asString(sysDefault?.email) ?? asString(currentAcc?.email)
  const wsLabel = asString(sysDefault?.workspaceLabel)
  if (email) {
    return {
      accountId: email,
      accountLabel: wsLabel ? `${email} (${wsLabel})` : email,
      planType
    }
  }

  const meta = asRecord(rlObj.usageMetadata)
  const provenance = asString(meta?.authProvenance) ?? 'default'
  const fallbackLabel = planType
    ? `${formatProviderName(provider)} (${planType})`
    : `${formatProviderName(provider)} (${provenance})`
  return {
    accountId: `${provider}:${provenance}`,
    accountLabel: fallbackLabel,
    planType
  }
}

function pushWindowIfPresent(
  out: QuotaWindowSample[],
  base: Omit<
    QuotaWindowSample,
    'windowId' | 'windowLabel' | 'windowMinutes' | 'usedPercent' | 'resetsAt' | 'resetDescription'
  >,
  windowId: string,
  windowLabel: string,
  raw: unknown
): void {
  const w = asRecord(raw) as RawWindow | null
  if (!w) return
  const usedPercent = asNumber(w.usedPercent)
  if (usedPercent === null) return
  out.push({
    ...base,
    windowId,
    windowLabel,
    windowMinutes: asNumber(w.windowMinutes),
    usedPercent,
    resetsAt: asNumber(w.resetsAt),
    resetDescription: asString(w.resetDescription)
  })
}

const KNOWN_RATE_LIMIT_PROVIDERS = [
  'claude',
  'codex',
  'antigravity',
  'gemini',
  'opencodeGo',
  'kimi',
  'minimax',
  'grok',
  'cursor',
  'zcode',
  'muse'
] as const

export function parseAccountListResponse(rawJson: unknown): QuotaWindowSample[] {
  const root = asRecord(rawJson)
  const resultObj = asRecord(root?.result) ?? root
  if (!resultObj) return []

  const rateLimits = asRecord(resultObj.rateLimits)
  if (!rateLimits) return []

  const samples: QuotaWindowSample[] = []

  for (const providerKey of KNOWN_RATE_LIMIT_PROVIDERS) {
    const rlObj = asRecord(rateLimits[providerKey])
    if (!rlObj || rlObj.status !== 'ok') continue

    const identity = resolveAccountIdentity(providerKey, resultObj, rlObj)
    const base = {
      provider: providerKey,
      accountId: identity.accountId,
      accountLabel: identity.accountLabel,
      planType: identity.planType,
      isActiveAccount: true
    }

    const buckets = Array.isArray(rlObj.buckets) ? (rlObj.buckets as RawBucket[]) : []
    if (buckets.length > 0) {
      for (const b of buckets) {
        const name = asString(b.name) ?? asString(b.windowName) ?? 'bucket'
        const windowId = `bucket:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
        pushWindowIfPresent(samples, base, windowId, name, b)
      }
    } else {
      pushWindowIfPresent(samples, base, 'session', '5h Session', rlObj.session)
      pushWindowIfPresent(samples, base, 'weekly', 'Weekly (7d)', rlObj.weekly)
      pushWindowIfPresent(samples, base, 'monthly', 'Monthly', rlObj.monthly)
    }
  }

  const inactiveLists: Array<{ provider: string; items: unknown }> = [
    { provider: 'claude', items: rateLimits.inactiveClaudeAccounts },
    { provider: 'codex', items: rateLimits.inactiveCodexAccounts },
    { provider: 'antigravity', items: rateLimits.antigravityAccounts }
  ]

  for (const { provider, items } of inactiveLists) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const acc = asRecord(item) as RawAccount | null
      if (!acc) continue
      const rl = asRecord(acc.rateLimit) ?? asRecord(acc.usage) ?? acc
      if (!rl || (rl.status !== undefined && rl.status !== 'ok')) continue
      const accountId = asString(acc.id) ?? asString(acc.accountId) ?? asString(acc.email)
      if (!accountId) continue
      const accountLabel =
        asString(acc.label) ?? asString(acc.email) ?? asString(acc.name) ?? accountId
      const planType = asString(rl.planType) ?? asString(acc.planType)
      const base = {
        provider,
        accountId,
        accountLabel,
        planType,
        isActiveAccount: false
      }
      pushWindowIfPresent(samples, base, 'session', '5h Session', rl.session)
      pushWindowIfPresent(samples, base, 'weekly', 'Weekly (7d)', rl.weekly)
    }
  }

  return samples
}

function isQuotaReset(prev: WindowTracker, next: QuotaWindowSample): boolean {
  if (
    prev.resetsAt !== null &&
    next.resetsAt !== null &&
    Math.abs(next.resetsAt - prev.resetsAt) > 5 * 60 * 1000
  ) {
    return true
  }
  if (next.usedPercent < prev.currentPercent - 2) {
    return true
  }
  return false
}

export function applySnapshot(
  prevState: TrackerState,
  quotas: QuotaWindowSample[],
  sessions: SessionRecord[],
  now: number,
  maxLedgerEntries = 300
): TrackerState {
  const isBaseline = prevState.lastPollAt === null
  const nextSessionTokens: Record<string, StoredSessionBaseline> = { ...prevState.sessionTokens }
  const deltaTokensByProvider: Record<string, number> = {}
  const sessionTitlesByProvider: Record<string, string[]> = {}

  for (const s of sessions) {
    if (!s.sessionId || typeof s.totalTokens !== 'number' || s.totalTokens < 0) continue
    const prev = prevState.sessionTokens[s.sessionId]
    const provider = normalizeAgentToProvider(s.agent)

    if (!isBaseline) {
      let delta = 0
      if (prev) {
        delta = Math.max(0, s.totalTokens - prev.totalTokens)
      } else {
        const cutoff = (prevState.lastPollAt ?? now) - 60_000
        const activityTime = s.createdAt ?? s.updatedAt
        if (activityTime >= cutoff) {
          delta = s.totalTokens
        }
      }
      if (delta > 0) {
        deltaTokensByProvider[provider] = (deltaTokensByProvider[provider] ?? 0) + delta
        const list = (sessionTitlesByProvider[provider] ??= [])
        const title = s.title?.trim()
        if (title && !list.includes(title) && list.length < 5) {
          list.push(title)
        }
      }
    }

    nextSessionTokens[s.sessionId] = {
      agent: s.agent,
      totalTokens: s.totalTokens,
      updatedAt: s.updatedAt
    }
  }

  const sessionEntries = Object.entries(nextSessionTokens)
  if (sessionEntries.length > 1000) {
    sessionEntries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    for (const [id] of sessionEntries.slice(1000)) {
      delete nextSessionTokens[id]
    }
  }

  const nextWindows: Record<string, WindowTracker> = { ...prevState.windows }
  for (const key of Object.keys(nextWindows)) {
    nextWindows[key] = { ...nextWindows[key], isActiveAccount: false }
  }

  const nextLedger: LedgerEntry[] = [...prevState.ledger]
  const nextPeriodStats: Record<string, PeriodStat> = { ...prevState.periodStats }

  for (const sample of quotas) {
    const key = `${sample.provider}::${sample.accountId}::${sample.windowId}`
    const existing = prevState.windows[key]
    const providerDeltaTokens = sample.isActiveAccount
      ? (deltaTokensByProvider[sample.provider] ?? 0)
      : 0
    const titles = sample.isActiveAccount ? (sessionTitlesByProvider[sample.provider] ?? []) : []

    if (!existing || isQuotaReset(existing, sample)) {
      nextWindows[key] = {
        key,
        provider: sample.provider,
        accountId: sample.accountId,
        accountLabel: sample.accountLabel,
        planType: sample.planType,
        isActiveAccount: sample.isActiveAccount,
        windowId: sample.windowId,
        windowLabel: sample.windowLabel,
        windowMinutes: sample.windowMinutes,
        resetsAt: sample.resetsAt,
        resetDescription: sample.resetDescription,
        baselinePercent: sample.usedPercent,
        currentPercent: sample.usedPercent,
        trackedDeltaPercent: 0,
        trackedTokens: 0,
        pendingTokens: 0,
        firstSeenAt: now,
        lastUpdatedAt: now
      }
      continue
    }

    const deltaPercent = Math.max(0, sample.usedPercent - existing.currentPercent)
    let trackedDeltaPercent = existing.trackedDeltaPercent
    let trackedTokens = existing.trackedTokens
    let pendingTokens = existing.pendingTokens

    if (deltaPercent > 0) {
      const jumpTokens = pendingTokens + providerDeltaTokens
      trackedDeltaPercent += deltaPercent
      trackedTokens += providerDeltaTokens
      pendingTokens = 0

      const entry: LedgerEntry = {
        id: `${now}-${key}`,
        timestamp: now,
        provider: sample.provider,
        accountId: sample.accountId,
        accountLabel: sample.accountLabel,
        windowId: sample.windowId,
        windowLabel: sample.windowLabel,
        fromPercent: existing.currentPercent,
        toPercent: sample.usedPercent,
        deltaPercent,
        deltaTokens: jumpTokens,
        tokensPerPercent: Math.round(jumpTokens / deltaPercent),
        sessionTitles: titles
      }

      nextLedger.unshift(entry)
      recordPeriodRollup(nextPeriodStats, entry, 'week')
      recordPeriodRollup(nextPeriodStats, entry, 'month')
    } else if (providerDeltaTokens > 0) {
      pendingTokens += providerDeltaTokens
      trackedTokens += providerDeltaTokens
    }

    nextWindows[key] = {
      ...existing,
      accountLabel: sample.accountLabel,
      planType: sample.planType ?? existing.planType,
      isActiveAccount: sample.isActiveAccount,
      windowLabel: sample.windowLabel,
      windowMinutes: sample.windowMinutes ?? existing.windowMinutes,
      resetsAt: sample.resetsAt ?? existing.resetsAt,
      resetDescription: sample.resetDescription ?? existing.resetDescription,
      currentPercent: sample.usedPercent,
      trackedDeltaPercent,
      trackedTokens,
      pendingTokens,
      lastUpdatedAt: now
    }
  }

  return {
    version: 2,
    lastPollAt: now,
    lastError: null,
    windows: nextWindows,
    ledger: nextLedger.slice(0, maxLedgerEntries),
    periodStats: nextPeriodStats,
    sessionTokens: nextSessionTokens
  }
}

function makeBar(value: number, max: number, width = 10): string {
  if (max <= 0 || value <= 0) return '░'.repeat(width)
  const filled = Math.max(1, Math.min(width, Math.round((value / max) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function pctChange(from: number, to: number): number | null {
  if (from <= 0) return null
  return ((to - from) / from) * 100
}

function buildTrendsForGranularity(
  periodStats: Record<string, PeriodStat>,
  periodType: PeriodGranularity,
  nerfAlertDropPercent: number
): { series: TrendSeriesSummary[]; rows: TrendPeriodRow[] } {
  const bySeries = new Map<string, PeriodStat[]>()

  for (const stat of Object.values(periodStats)) {
    if (stat.periodType !== periodType || stat.totalDeltaPercent <= 0) continue
    const seriesKey = `${stat.provider}::${stat.accountId}::${stat.windowId}`
    const list = bySeries.get(seriesKey) ?? []
    list.push(stat)
    bySeries.set(seriesKey, list)
  }

  const series: TrendSeriesSummary[] = []
  const rows: TrendPeriodRow[] = []

  for (const [seriesKey, items] of bySeries.entries()) {
    // Chronological order (oldest -> newest)
    items.sort((a, b) => a.periodKey.localeCompare(b.periodKey))
    const rates = items.map((s) => Math.round(s.totalDeltaTokens / s.totalDeltaPercent))
    const maxRate = Math.max(...rates, 0)
    const baselineRate = rates[0]

    const seriesRows: TrendPeriodRow[] = items.map((s, idx) => {
      const rate = rates[idx]
      const prevRate = idx > 0 ? rates[idx - 1] : null
      return {
        key: s.key,
        periodType: s.periodType,
        periodKey: s.periodKey,
        provider: s.provider,
        accountId: s.accountId,
        accountLabel: s.accountLabel,
        windowId: s.windowId,
        windowLabel: s.windowLabel,
        totalDeltaPercent: s.totalDeltaPercent,
        totalDeltaTokens: s.totalDeltaTokens,
        tokensPerPercent: rate,
        estimated100PercentTokens: rate * 100,
        sampleCount: s.sampleCount,
        prevChangePercent: prevRate !== null ? pctChange(prevRate, rate) : null,
        baselineChangePercent: idx > 0 ? pctChange(baselineRate, rate) : null,
        bar: makeBar(rate, maxRate)
      }
    })

    const latest = items[items.length - 1]
    const latestRate = rates[rates.length - 1]
    const previousRate = rates.length >= 2 ? rates[rates.length - 2] : null
    const vsBaseline = items.length >= 2 ? pctChange(baselineRate, latestRate) : null
    const vsPrevious = previousRate !== null ? pctChange(previousRate, latestRate) : null

    let status: DriftStatus = 'collecting'
    if (items.length >= 2 && vsBaseline !== null) {
      if (vsBaseline <= -nerfAlertDropPercent && latest.totalDeltaPercent >= 2) {
        status = 'degraded'
      } else if (vsBaseline <= -(nerfAlertDropPercent / 2)) {
        status = 'watch'
      } else {
        status = 'stable'
      }
    }

    series.push({
      seriesKey,
      periodType,
      provider: latest.provider,
      accountId: latest.accountId,
      accountLabel: latest.accountLabel,
      windowId: latest.windowId,
      windowLabel: latest.windowLabel,
      periodCount: items.length,
      baselinePeriodKey: items[0].periodKey,
      baselineTokensPerPercent: baselineRate,
      latestPeriodKey: latest.periodKey,
      latestTokensPerPercent: latestRate,
      latestDeltaPercent: latest.totalDeltaPercent,
      previousTokensPerPercent: previousRate,
      vsBaselinePercent: vsBaseline,
      vsPreviousPercent: vsPrevious,
      status
    })

    // Show newest periods first in table
    rows.push(...seriesRows.reverse())
  }

  series.sort((a, b) => {
    const rank = { degraded: 0, watch: 1, stable: 2, collecting: 3 }
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
    return a.accountLabel.localeCompare(b.accountLabel)
  })

  rows.sort((a, b) => {
    if (a.periodKey !== b.periodKey) return b.periodKey.localeCompare(a.periodKey)
    return a.accountLabel.localeCompare(b.accountLabel)
  })

  return { series, rows }
}

export function buildDashboardView(
  state: TrackerState,
  nerfAlertDropPercent = 15
): DashboardView {
  const windows: WindowSummaryView[] = Object.values(state.windows)
    .map((w) => {
      const tokensPerPercent =
        w.trackedDeltaPercent > 0 ? Math.round(w.trackedTokens / w.trackedDeltaPercent) : null
      const estimated100PercentTokens =
        tokensPerPercent !== null ? tokensPerPercent * 100 : null
      return {
        ...w,
        tokensPerPercent,
        estimated100PercentTokens
      }
    })
    .sort((a, b) => {
      if (a.isActiveAccount !== b.isActiveAccount) return a.isActiveAccount ? -1 : 1
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
      return (a.windowMinutes ?? 999999) - (b.windowMinutes ?? 999999)
    })

  const weekly = buildTrendsForGranularity(state.periodStats, 'week', nerfAlertDropPercent)
  const monthly = buildTrendsForGranularity(state.periodStats, 'month', nerfAlertDropPercent)

  const degradedAlerts = [
    ...weekly.series.filter((s) => s.status === 'degraded'),
    ...monthly.series.filter((s) => s.status === 'degraded')
  ]

  const primary =
    windows.find((w) => w.isActiveAccount && w.trackedDeltaPercent > 0) ??
    windows.find((w) => w.isActiveAccount) ??
    windows[0]

  let statusBarText = 'Token Tracker'
  let statusBarTooltip = '계정별 % 대비 토큰 사용량 및 주간/월간 추이 감시'
  let statusBarTone: DashboardView['statusBarTone'] = 'neutral'

  if (primary) {
    const providerShort = formatProviderName(primary.provider)
    const ratePart =
      primary.tokensPerPercent !== null
        ? ` · ${formatTokens(primary.tokensPerPercent)}/1%`
        : primary.trackedTokens > 0
          ? ` · +${formatTokens(primary.trackedTokens)}`
          : ''
    const alertSuffix = degradedAlerts.length > 0 ? ' ⚠' : ''
    statusBarText = `${providerShort} ${primary.currentPercent}%${ratePart}${alertSuffix}`
    statusBarTooltip =
      `${primary.accountLabel} (${primary.windowLabel})\n` +
      `현재 ${primary.currentPercent}% · 추적 Δ${primary.trackedDeltaPercent}% / ${formatTokens(primary.trackedTokens)} tokens` +
      (primary.tokensPerPercent !== null
        ? `\n1%당 약 ${formatTokens(primary.tokensPerPercent)} tokens (100% 추정: ${formatTokens(primary.estimated100PercentTokens)})`
        : '') +
      (degradedAlerts.length > 0
        ? `\n⚠ 너프 의심 감지: ${degradedAlerts[0].accountLabel} (${formatSignedPercent(degradedAlerts[0].vsBaselinePercent)})`
        : '')

    if (degradedAlerts.length > 0 || primary.currentPercent >= 90) statusBarTone = 'danger'
    else if (primary.currentPercent >= 75) statusBarTone = 'warning'
    else if (primary.trackedDeltaPercent > 0) statusBarTone = 'accent'
  }

  return {
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    nerfAlertDropPercent,
    windows,
    ledger: state.ledger,
    weeklySeries: weekly.series,
    weeklyRows: weekly.rows,
    monthlySeries: monthly.series,
    monthlyRows: monthly.rows,
    degradedAlerts,
    statusBarText,
    statusBarTooltip,
    statusBarTone
  }
}

export function buildLedgerCsv(ledger: LedgerEntry[]): string {
  const header = [
    'timestamp',
    'provider',
    'account',
    'window',
    'from_percent',
    'to_percent',
    'delta_percent',
    'delta_tokens',
    'tokens_per_1pct',
    'sessions'
  ].join(',')

  const escape = (v: string | number): string => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows = ledger.map((e) =>
    [
      new Date(e.timestamp).toISOString(),
      e.provider,
      e.accountLabel,
      e.windowLabel,
      e.fromPercent,
      e.toPercent,
      e.deltaPercent,
      e.deltaTokens,
      e.tokensPerPercent,
      e.sessionTitles.join(' | ')
    ]
      .map(escape)
      .join(',')
  )

  return [header, ...rows].join('\n')
}

export function buildTrendsCsv(rows: TrendPeriodRow[]): string {
  const header = [
    'period_type',
    'period',
    'provider',
    'account',
    'window',
    'tracked_delta_percent',
    'tracked_tokens',
    'tokens_per_1pct',
    'estimated_100pct_tokens',
    'prev_change_pct',
    'baseline_change_pct',
    'samples'
  ].join(',')

  const escape = (v: string | number | null): string => {
    if (v === null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const lines = rows.map((r) =>
    [
      r.periodType,
      r.periodKey,
      r.provider,
      r.accountLabel,
      r.windowLabel,
      r.totalDeltaPercent,
      r.totalDeltaTokens,
      r.tokensPerPercent,
      r.estimated100PercentTokens,
      r.prevChangePercent !== null ? r.prevChangePercent.toFixed(1) : null,
      r.baselineChangePercent !== null ? r.baselineChangePercent.toFixed(1) : null,
      r.sampleCount
    ]
      .map(escape)
      .join(',')
  )

  return [header, ...lines].join('\n')
}
