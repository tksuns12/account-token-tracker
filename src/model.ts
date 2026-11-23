import {
  addModelUsage,
  createEmptyModelUsage,
  estimateBlendedCostUsd,
  formatUsd,
  mergeModelUsageMaps,
  shortenModelName,
  type ModelTokenUsage
} from './pricing'

/**
 * Filters Antigravity model deltas to the specific quota bucket they consume
 * (e.g., Gemini Models vs Claude & GPT models vs Gemini 4 Argon).
 */
export function filterModelsForWindow(
  provider: string,
  windowId: string,
  windowLabel: string,
  models: Record<string, ModelTokenUsage>
): Record<string, ModelTokenUsage> {
  if (provider !== 'antigravity') return models
  const w = `${windowId} ${windowLabel}`.toLowerCase()

  const isArgonBucket = w.includes('argon')
  const isClaudeGptBucket = w.includes('claude') || w.includes('gpt')
  const isGeminiBucket = w.includes('gemini') && !isArgonBucket

  if (!isArgonBucket && !isClaudeGptBucket && !isGeminiBucket) {
    return models
  }

  const out: Record<string, ModelTokenUsage> = {}
  for (const [model, usage] of Object.entries(models)) {
    const m = model.toLowerCase()
    if (isArgonBucket) {
      if (m.includes('argon')) out[model] = usage
    } else if (isClaudeGptBucket) {
      if (/claude|opus|sonnet|haiku|fable|gpt|o[134]/.test(m)) out[model] = usage
    } else if (isGeminiBucket) {
      if (m.includes('gemini') && !m.includes('argon')) out[model] = usage
    }
  }
  return out
}

export { formatUsd, shortenModelName, type ModelTokenUsage }

export interface SessionRecord {
  sessionId: string
  agent: string
  title: string
  updatedAt: number
  createdAt: number | null
  totalTokens: number
  /** Exact per-model token & USD breakdown when local logs are available. */
  models?: Record<string, ModelTokenUsage>
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
  trackedCostUsd: number
  pendingCostUsd: number
  trackedModels: Record<string, ModelTokenUsage>
  pendingModels: Record<string, ModelTokenUsage>
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
  windowMinutes?: number | null
  fromPercent: number
  toPercent: number
  deltaPercent: number
  deltaTokens: number
  tokensPerPercent: number
  deltaCostUsd: number
  usdPerPercent: number
  models: Record<string, ModelTokenUsage>
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
  windowMinutes?: number | null
  totalDeltaPercent: number
  totalDeltaTokens: number
  totalDeltaCostUsd: number
  models: Record<string, ModelTokenUsage>
  sampleCount: number
  firstTimestamp: number
  lastTimestamp: number
}

export interface StoredSessionBaseline {
  agent: string
  totalTokens: number
  updatedAt: number
  models?: Record<string, ModelTokenUsage>
}

export interface TrackerState {
  version: 3
  lastPollAt: number | null
  lastError: string | null
  windows: Record<string, WindowTracker>
  ledger: LedgerEntry[]
  periodStats: Record<string, PeriodStat>
  sessionTokens: Record<string, StoredSessionBaseline>
  claudeFileOffsets: Record<string, number>
  antigravityFileOffsets: Record<string, number>
}

export interface ModelBreakdownItem {
  model: string
  shortName: string
  costUsd: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  sharePercent: number
}

export interface WindowSummaryView extends WindowTracker {
  tokensPerPercent: number | null
  estimated100PercentTokens: number | null
  usdPerPercent: number | null
  estimated100PercentUsd: number | null
  estimatedMonthlyUsd: number | null
  modelBreakdown: ModelBreakdownItem[]
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
  totalDeltaCostUsd: number
  tokensPerPercent: number
  estimated100PercentTokens: number
  usdPerPercent: number
  estimated100PercentUsd: number
  estimatedMonthlyUsd: number
  topModelsSummary: string
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
  baselineUsdPerPercent: number
  baselineMonthlyUsd: number
  latestPeriodKey: string
  latestTokensPerPercent: number
  latestUsdPerPercent: number
  latestMonthlyUsd: number
  latestDeltaPercent: number
  previousTokensPerPercent: number | null
  previousUsdPerPercent: number | null
  previousMonthlyUsd: number | null
  vsBaselinePercent: number | null
  vsPreviousPercent: number | null
  metricKind: 'usd' | 'tokens'
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
    version: 3,
    lastPollAt: null,
    lastError: null,
    windows: {},
    ledger: [],
    periodStats: {},
    sessionTokens: {},
    claudeFileOffsets: {},
    antigravityFileOffsets: {}
  }
}

/** Formats a UTC timestamp into an ISO-8601 week key such as `2026-W47`. */
export function getIsoWeekKey(timestampMs: number): string {
  const d = new Date(timestampMs)
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

const MINUTES_PER_MONTH = 30 * 24 * 60 // 43,200 minutes (30 days)

/** Resolves a quota window's length in minutes from explicit metadata or its id/label. */
export function inferWindowMinutes(
  windowMinutes: number | null | undefined,
  windowId: string,
  windowLabel: string
): number {
  if (typeof windowMinutes === 'number' && Number.isFinite(windowMinutes) && windowMinutes > 0) {
    return windowMinutes
  }
  const combined = `${windowId} ${windowLabel}`.toLowerCase()
  if (combined.includes('month') || combined.includes('30d')) return MINUTES_PER_MONTH
  if (combined.includes('week') || combined.includes('7d')) return 7 * 24 * 60
  if (combined.includes('five hour') || combined.includes('5h') || windowId === 'session') {
    return 5 * 60
  }
  return 7 * 24 * 60
}

/** Converts a $/1% rate for a quota window into an estimated 30-day (monthly) total dollar value. */
export function estimateMonthlyUsd(
  usdPerPercent: number,
  windowMinutes: number | null | undefined,
  windowId: string,
  windowLabel: string
): number {
  if (!Number.isFinite(usdPerPercent) || usdPerPercent <= 0) return 0
  const mins = inferWindowMinutes(windowMinutes, windowId, windowLabel)
  const cyclesPerMonth = MINUTES_PER_MONTH / mins
  return usdPerPercent * 100 * cyclesPerMonth
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
      windowMinutes: entry.windowMinutes ?? null,
      totalDeltaPercent: entry.deltaPercent,
      totalDeltaTokens: entry.deltaTokens,
      totalDeltaCostUsd: entry.deltaCostUsd,
      models: mergeModelUsageMaps({}, entry.models),
      sampleCount: 1,
      firstTimestamp: entry.timestamp,
      lastTimestamp: entry.timestamp
    }
  } else {
    periodStats[key] = {
      ...existing,
      accountLabel: entry.accountLabel,
      windowLabel: entry.windowLabel,
      windowMinutes: entry.windowMinutes ?? existing.windowMinutes ?? null,
      totalDeltaPercent: existing.totalDeltaPercent + entry.deltaPercent,
      totalDeltaTokens: existing.totalDeltaTokens + entry.deltaTokens,
      totalDeltaCostUsd: existing.totalDeltaCostUsd + entry.deltaCostUsd,
      models: mergeModelUsageMaps(existing.models ?? {}, entry.models),
      sampleCount: existing.sampleCount + 1,
      firstTimestamp: Math.min(existing.firstTimestamp, entry.timestamp),
      lastTimestamp: Math.max(existing.lastTimestamp, entry.timestamp)
    }
  }
}

/** Upgrades v1, v2, or partial persisted state to v3 cleanly. */
export function migrateState(raw: unknown): TrackerState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createEmptyState()
  }
  const obj = raw as Partial<TrackerState> & { version?: number }
  if (obj.version !== 1 && obj.version !== 2 && obj.version !== 3) {
    return createEmptyState()
  }

  const rawLedger = Array.isArray(obj.ledger) ? obj.ledger : []
  const ledger: LedgerEntry[] = rawLedger.map((e) => {
    const deltaCostUsd =
      typeof e.deltaCostUsd === 'number' && Number.isFinite(e.deltaCostUsd) ? e.deltaCostUsd : 0
    const usdPerPercent =
      typeof e.usdPerPercent === 'number' && Number.isFinite(e.usdPerPercent)
        ? e.usdPerPercent
        : e.deltaPercent > 0
          ? deltaCostUsd / e.deltaPercent
          : 0
    return {
      ...e,
      deltaCostUsd,
      usdPerPercent,
      models: e.models && typeof e.models === 'object' ? e.models : {}
    }
  })

  const rawWindows = obj.windows && typeof obj.windows === 'object' ? obj.windows : {}
  const windows: Record<string, WindowTracker> = {}
  for (const [k, w] of Object.entries(rawWindows)) {
    windows[k] = {
      ...w,
      trackedCostUsd: typeof w.trackedCostUsd === 'number' ? w.trackedCostUsd : 0,
      pendingCostUsd: typeof w.pendingCostUsd === 'number' ? w.pendingCostUsd : 0,
      trackedModels: w.trackedModels && typeof w.trackedModels === 'object' ? w.trackedModels : {},
      pendingModels: w.pendingModels && typeof w.pendingModels === 'object' ? w.pendingModels : {}
    }
  }

  const periodStats: Record<string, PeriodStat> = {}
  if ((obj.version === 2 || obj.version === 3) && obj.periodStats && typeof obj.periodStats === 'object') {
    for (const [k, s] of Object.entries(obj.periodStats)) {
      periodStats[k] = {
        ...s,
        totalDeltaCostUsd: typeof s.totalDeltaCostUsd === 'number' ? s.totalDeltaCostUsd : 0,
        models: s.models && typeof s.models === 'object' ? s.models : {}
      }
    }
  }

  if (obj.version === 1 || Object.keys(periodStats).length === 0) {
    for (const entry of ledger) {
      recordPeriodRollup(periodStats, entry, 'week')
      recordPeriodRollup(periodStats, entry, 'month')
    }
  }

  return {
    version: 3,
    lastPollAt: typeof obj.lastPollAt === 'number' ? obj.lastPollAt : null,
    lastError: typeof obj.lastError === 'string' ? obj.lastError : null,
    windows,
    ledger,
    periodStats,
    sessionTokens:
      obj.sessionTokens && typeof obj.sessionTokens === 'object' ? obj.sessionTokens : {},
    claudeFileOffsets:
      obj.claudeFileOffsets && typeof obj.claudeFileOffsets === 'object'
        ? obj.claudeFileOffsets
        : {},
    antigravityFileOffsets:
      obj.antigravityFileOffsets && typeof obj.antigravityFileOffsets === 'object'
        ? obj.antigravityFileOffsets
        : {}
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

export function buildModelBreakdown(
  models: Record<string, ModelTokenUsage> | undefined
): ModelBreakdownItem[] {
  if (!models) return []
  const entries = Object.entries(models).filter(([, u]) => u.totalTokens > 0 || u.costUsd > 0)
  const totalCost = entries.reduce((sum, [, u]) => sum + u.costUsd, 0)
  const totalTokens = entries.reduce((sum, [, u]) => sum + u.totalTokens, 0)

  return entries
    .map(([model, u]) => {
      const sharePercent =
        totalCost > 0
          ? (u.costUsd / totalCost) * 100
          : totalTokens > 0
            ? (u.totalTokens / totalTokens) * 100
            : 0
      return {
        model,
        shortName: shortenModelName(model),
        costUsd: u.costUsd,
        totalTokens: u.totalTokens,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWrite5mTokens + u.cacheWrite1hTokens,
        sharePercent
      }
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens)
}

export function summarizeTopModels(
  models: Record<string, ModelTokenUsage> | undefined,
  maxItems = 2
): string {
  const list = buildModelBreakdown(models)
  if (list.length === 0) return '-'
  return list
    .slice(0, maxItems)
    .map((m) => `${m.shortName} ${formatUsd(m.costUsd)}`)
    .join(', ')
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

function diffModelUsage(
  curr: ModelTokenUsage,
  prev: ModelTokenUsage | undefined
): ModelTokenUsage {
  if (!prev) return { ...curr }
  const inputTokens = Math.max(0, curr.inputTokens - prev.inputTokens)
  const outputTokens = Math.max(0, curr.outputTokens - prev.outputTokens)
  const cacheWrite5mTokens = Math.max(0, curr.cacheWrite5mTokens - prev.cacheWrite5mTokens)
  const cacheWrite1hTokens = Math.max(0, curr.cacheWrite1hTokens - prev.cacheWrite1hTokens)
  const cacheReadTokens = Math.max(0, curr.cacheReadTokens - prev.cacheReadTokens)
  const totalTokens = Math.max(0, curr.totalTokens - prev.totalTokens)
  const costUsd = Math.max(0, curr.costUsd - prev.costUsd)
  return {
    inputTokens,
    outputTokens,
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    cacheReadTokens,
    totalTokens,
    costUsd
  }
}

export function applySnapshot(
  prevState: TrackerState,
  quotas: QuotaWindowSample[],
  sessions: SessionRecord[],
  now: number,
  maxLedgerEntries = 300,
  directProviderDeltas?: Record<string, Record<string, ModelTokenUsage>>,
  nextClaudeFileOffsets?: Record<string, number>,
  nextAntigravityFileOffsets?: Record<string, number>
): TrackerState {
  const isBaseline = prevState.lastPollAt === null
  const nextSessionTokens: Record<string, StoredSessionBaseline> = { ...prevState.sessionTokens }
  const deltaTokensByProvider: Record<string, number> = {}
  const deltaCostByProvider: Record<string, number> = {}
  const deltaModelsByProvider: Record<string, Record<string, ModelTokenUsage>> = {}
  const sessionTitlesByProvider: Record<string, string[]> = {}

  if (!isBaseline && directProviderDeltas) {
    for (const [provider, models] of Object.entries(directProviderDeltas)) {
      let sumTokens = 0
      let sumCost = 0
      for (const u of Object.values(models)) {
        sumTokens += u.totalTokens
        sumCost += u.costUsd
      }
      if (sumTokens > 0 || sumCost > 0) {
        deltaTokensByProvider[provider] = (deltaTokensByProvider[provider] ?? 0) + sumTokens
        deltaCostByProvider[provider] = (deltaCostByProvider[provider] ?? 0) + sumCost
        deltaModelsByProvider[provider] = mergeModelUsageMaps(
          deltaModelsByProvider[provider] ?? {},
          models
        )
      }
    }
  }

  for (const s of sessions) {
    if (!s.sessionId || typeof s.totalTokens !== 'number' || s.totalTokens < 0) continue
    const prev = prevState.sessionTokens[s.sessionId]
    const provider = normalizeAgentToProvider(s.agent)

    if (!isBaseline) {
      const cutoff = (prevState.lastPollAt ?? now) - 60_000
      const activityTime = s.createdAt ?? s.updatedAt
      const allowNewSession = !prev && activityTime >= cutoff

      if (s.models && Object.keys(s.models).length > 0) {
        if (prev || allowNewSession) {
          let sessionDeltaTokens = 0
          let sessionDeltaCost = 0
          const providerModels = (deltaModelsByProvider[provider] ??= {})
          for (const [modelName, usage] of Object.entries(s.models)) {
            const d = diffModelUsage(usage, prev?.models?.[modelName])
            if (d.totalTokens > 0 || d.costUsd > 0) {
              sessionDeltaTokens += d.totalTokens
              sessionDeltaCost += d.costUsd
              providerModels[modelName] = providerModels[modelName]
                ? addModelUsage(providerModels[modelName], d)
                : d
            }
          }
          if (sessionDeltaTokens > 0 || sessionDeltaCost > 0) {
            deltaTokensByProvider[provider] =
              (deltaTokensByProvider[provider] ?? 0) + sessionDeltaTokens
            deltaCostByProvider[provider] =
              (deltaCostByProvider[provider] ?? 0) + sessionDeltaCost
            const list = (sessionTitlesByProvider[provider] ??= [])
            const title = s.title?.trim()
            if (title && !list.includes(title) && list.length < 5) list.push(title)
          }
        }
      } else {
        let delta = 0
        if (prev) {
          delta = Math.max(0, s.totalTokens - prev.totalTokens)
        } else if (allowNewSession) {
          delta = s.totalTokens
        }
        if (delta > 0) {
          const estUsd = estimateBlendedCostUsd(provider, delta)
          deltaTokensByProvider[provider] = (deltaTokensByProvider[provider] ?? 0) + delta
          deltaCostByProvider[provider] = (deltaCostByProvider[provider] ?? 0) + estUsd
          const modelKey = `${provider} (est.)`
          const providerModels = (deltaModelsByProvider[provider] ??= {})
          const estUsage: ModelTokenUsage = {
            ...createEmptyModelUsage(),
            totalTokens: delta,
            costUsd: estUsd
          }
          providerModels[modelKey] = providerModels[modelKey]
            ? addModelUsage(providerModels[modelKey], estUsage)
            : estUsage

          const list = (sessionTitlesByProvider[provider] ??= [])
          const title = s.title?.trim()
          if (title && !list.includes(title) && list.length < 5) list.push(title)
        }
      }
    }

    const baseline: StoredSessionBaseline = {
      agent: s.agent,
      totalTokens: s.totalTokens,
      updatedAt: s.updatedAt
    }
    if (s.models) {
      baseline.models = { ...s.models }
    }
    nextSessionTokens[s.sessionId] = baseline
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
    const rawProviderModels = sample.isActiveAccount
      ? (deltaModelsByProvider[sample.provider] ?? {})
      : {}
    const providerDeltaModels = filterModelsForWindow(
      sample.provider,
      sample.windowId,
      sample.windowLabel,
      rawProviderModels
    )
    const isFilteredBucket = sample.provider === 'antigravity'
    let providerDeltaTokens = 0
    let providerDeltaCost = 0
    if (isFilteredBucket) {
      for (const u of Object.values(providerDeltaModels)) {
        providerDeltaTokens += u.totalTokens
        providerDeltaCost += u.costUsd
      }
    } else if (sample.isActiveAccount) {
      providerDeltaTokens = deltaTokensByProvider[sample.provider] ?? 0
      providerDeltaCost = deltaCostByProvider[sample.provider] ?? 0
    }
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
        trackedCostUsd: 0,
        pendingCostUsd: 0,
        trackedModels: {},
        pendingModels: {},
        firstSeenAt: now,
        lastUpdatedAt: now
      }
      continue
    }

    const deltaPercent = Math.max(0, sample.usedPercent - existing.currentPercent)
    let trackedDeltaPercent = existing.trackedDeltaPercent
    let trackedTokens = existing.trackedTokens
    let pendingTokens = existing.pendingTokens
    let trackedCostUsd = existing.trackedCostUsd
    let pendingCostUsd = existing.pendingCostUsd
    let trackedModels = existing.trackedModels
    let pendingModels = existing.pendingModels

    if (deltaPercent > 0) {
      const jumpTokens = pendingTokens + providerDeltaTokens
      const jumpCostUsd = pendingCostUsd + providerDeltaCost
      const jumpModels = mergeModelUsageMaps(pendingModels, providerDeltaModels)

      trackedDeltaPercent += deltaPercent
      trackedTokens += providerDeltaTokens
      trackedCostUsd += providerDeltaCost
      trackedModels = mergeModelUsageMaps(trackedModels, providerDeltaModels)
      pendingTokens = 0
      pendingCostUsd = 0
      pendingModels = {}

      const entry: LedgerEntry = {
        id: `${now}-${key}`,
        timestamp: now,
        provider: sample.provider,
        accountId: sample.accountId,
        accountLabel: sample.accountLabel,
        windowId: sample.windowId,
        windowLabel: sample.windowLabel,
        windowMinutes: sample.windowMinutes ?? existing.windowMinutes,
        fromPercent: existing.currentPercent,
        toPercent: sample.usedPercent,
        deltaPercent,
        deltaTokens: jumpTokens,
        tokensPerPercent: Math.round(jumpTokens / deltaPercent),
        deltaCostUsd: jumpCostUsd,
        usdPerPercent: jumpCostUsd / deltaPercent,
        models: jumpModels,
        sessionTitles: titles
      }

      nextLedger.unshift(entry)
      recordPeriodRollup(nextPeriodStats, entry, 'week')
      recordPeriodRollup(nextPeriodStats, entry, 'month')
    } else if (providerDeltaTokens > 0 || providerDeltaCost > 0) {
      pendingTokens += providerDeltaTokens
      trackedTokens += providerDeltaTokens
      pendingCostUsd += providerDeltaCost
      trackedCostUsd += providerDeltaCost
      pendingModels = mergeModelUsageMaps(pendingModels, providerDeltaModels)
      trackedModels = mergeModelUsageMaps(trackedModels, providerDeltaModels)
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
      trackedCostUsd,
      pendingCostUsd,
      trackedModels,
      pendingModels,
      lastUpdatedAt: now
    }
  }

  return {
    version: 3,
    lastPollAt: now,
    lastError: null,
    windows: nextWindows,
    ledger: nextLedger.slice(0, maxLedgerEntries),
    periodStats: nextPeriodStats,
    sessionTokens: nextSessionTokens,
    claudeFileOffsets: nextClaudeFileOffsets ?? prevState.claudeFileOffsets,
    antigravityFileOffsets: nextAntigravityFileOffsets ?? prevState.antigravityFileOffsets
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
    items.sort((a, b) => a.periodKey.localeCompare(b.periodKey))

    const tokenRates = items.map((s) => Math.round(s.totalDeltaTokens / s.totalDeltaPercent))
    const usdRates = items.map((s) => s.totalDeltaCostUsd / s.totalDeltaPercent)
    const monthlyUsdRates = items.map((s, idx) =>
      estimateMonthlyUsd(usdRates[idx], s.windowMinutes, s.windowId, s.windowLabel)
    )
    // Prefer monthly USD value for enshittification detection whenever baseline has dollar data
    const useUsd = monthlyUsdRates[0] > 0 && monthlyUsdRates[monthlyUsdRates.length - 1] > 0
    const primaryRates = useUsd ? monthlyUsdRates : tokenRates
    const maxPrimary = Math.max(...primaryRates, 0)
    const baselinePrimary = primaryRates[0]

    const seriesRows: TrendPeriodRow[] = items.map((s, idx) => {
      const tRate = tokenRates[idx]
      const uRate = usdRates[idx]
      const mUsd = monthlyUsdRates[idx]
      const pRate = primaryRates[idx]
      const prevPrimary = idx > 0 ? primaryRates[idx - 1] : null
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
        totalDeltaCostUsd: s.totalDeltaCostUsd,
        tokensPerPercent: tRate,
        estimated100PercentTokens: tRate * 100,
        usdPerPercent: uRate,
        estimated100PercentUsd: uRate * 100,
        estimatedMonthlyUsd: mUsd,
        topModelsSummary: summarizeTopModels(s.models, 2),
        sampleCount: s.sampleCount,
        prevChangePercent: prevPrimary !== null ? pctChange(prevPrimary, pRate) : null,
        baselineChangePercent: idx > 0 ? pctChange(baselinePrimary, pRate) : null,
        bar: makeBar(pRate, maxPrimary)
      }
    })

    const latest = items[items.length - 1]
    const latestTokenRate = tokenRates[tokenRates.length - 1]
    const latestUsdRate = usdRates[usdRates.length - 1]
    const latestMonthlyUsd = monthlyUsdRates[monthlyUsdRates.length - 1]
    const prevTokenRate = tokenRates.length >= 2 ? tokenRates[tokenRates.length - 2] : null
    const prevUsdRate = usdRates.length >= 2 ? usdRates[usdRates.length - 2] : null
    const prevMonthlyUsd =
      monthlyUsdRates.length >= 2 ? monthlyUsdRates[monthlyUsdRates.length - 2] : null
    const latestPrimary = primaryRates[primaryRates.length - 1]
    const prevPrimary = primaryRates.length >= 2 ? primaryRates[primaryRates.length - 2] : null

    const vsBaseline = items.length >= 2 ? pctChange(baselinePrimary, latestPrimary) : null
    const vsPrevious = prevPrimary !== null ? pctChange(prevPrimary, latestPrimary) : null

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
      baselineTokensPerPercent: tokenRates[0],
      baselineUsdPerPercent: usdRates[0],
      baselineMonthlyUsd: monthlyUsdRates[0],
      latestPeriodKey: latest.periodKey,
      latestTokensPerPercent: latestTokenRate,
      latestUsdPerPercent: latestUsdRate,
      latestMonthlyUsd,
      latestDeltaPercent: latest.totalDeltaPercent,
      previousTokensPerPercent: prevTokenRate,
      previousUsdPerPercent: prevUsdRate,
      previousMonthlyUsd: prevMonthlyUsd,
      vsBaselinePercent: vsBaseline,
      vsPreviousPercent: vsPrevious,
      metricKind: useUsd ? 'usd' : 'tokens',
      status
    })

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
      const usdPerPercent =
        w.trackedDeltaPercent > 0 && w.trackedCostUsd > 0
          ? w.trackedCostUsd / w.trackedDeltaPercent
          : null
      const estimated100PercentUsd = usdPerPercent !== null ? usdPerPercent * 100 : null
      const estimatedMonthlyUsd =
        usdPerPercent !== null
          ? estimateMonthlyUsd(usdPerPercent, w.windowMinutes, w.windowId, w.windowLabel)
          : null
      const modelBreakdown = buildModelBreakdown(w.trackedModels)
      return {
        ...w,
        tokensPerPercent,
        estimated100PercentTokens,
        usdPerPercent,
        estimated100PercentUsd,
        estimatedMonthlyUsd,
        modelBreakdown
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
    windows.find(
      (w) =>
        w.isActiveAccount &&
        w.estimatedMonthlyUsd !== null &&
        inferWindowMinutes(w.windowMinutes, w.windowId, w.windowLabel) >= 7 * 24 * 60
    ) ??
    windows.find((w) => w.isActiveAccount && w.estimatedMonthlyUsd !== null) ??
    windows.find((w) => w.isActiveAccount && w.trackedDeltaPercent > 0) ??
    windows.find((w) => w.isActiveAccount) ??
    windows[0]

  let statusBarText = 'Token Tracker'
  let statusBarTooltip = '계정별 사용량 및 추정 월간 달러 가치($/월) 감시'
  let statusBarTone: DashboardView['statusBarTone'] = 'neutral'

  if (primary) {
    const providerShort = formatProviderName(primary.provider)
    const ratePart =
      primary.estimatedMonthlyUsd !== null
        ? ` · ~${formatUsd(primary.estimatedMonthlyUsd)}/월`
        : primary.trackedCostUsd > 0
          ? ` · +${formatUsd(primary.trackedCostUsd)}`
          : ''
    const alertSuffix = degradedAlerts.length > 0 ? ' ⚠' : ''
    statusBarText = `${providerShort} ${primary.currentPercent}%${ratePart}${alertSuffix}`
    statusBarTooltip =
      `${primary.accountLabel} (${primary.windowLabel})\n` +
      `현재 ${primary.currentPercent}% · 추적 Δ${primary.trackedDeltaPercent}% / ${formatUsd(primary.trackedCostUsd)} (${formatTokens(primary.trackedTokens)} tok)` +
      (primary.estimatedMonthlyUsd !== null
        ? `\n추정 한 달치 가치: 약 ${formatUsd(primary.estimatedMonthlyUsd)}/월`
        : '') +
      (degradedAlerts.length > 0
        ? `\n⚠ 가치 하락(Enshittification) 의심: ${degradedAlerts[0].accountLabel} (${formatSignedPercent(degradedAlerts[0].vsBaselinePercent)})`
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
    'delta_cost_usd',
    'usd_per_1pct',
    'delta_tokens',
    'tokens_per_1pct',
    'models',
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
      e.deltaCostUsd.toFixed(4),
      e.usdPerPercent.toFixed(4),
      e.deltaTokens,
      e.tokensPerPercent,
      summarizeTopModels(e.models, 5),
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
    'tracked_cost_usd',
    'estimated_monthly_usd',
    'usd_per_1pct',
    'tracked_tokens',
    'top_models',
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
      r.totalDeltaCostUsd.toFixed(4),
      r.estimatedMonthlyUsd.toFixed(2),
      r.usdPerPercent.toFixed(4),
      r.totalDeltaTokens,
      r.topModelsSummary,
      r.prevChangePercent !== null ? r.prevChangePercent.toFixed(1) : null,
      r.baselineChangePercent !== null ? r.baselineChangePercent.toFixed(1) : null,
      r.sampleCount
    ]
      .map(escape)
      .join(',')
  )

  return [header, ...lines].join('\n')
}
