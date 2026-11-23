import type { MessageUsageWatermark } from './claude-logs'
import {
  addModelUsage,
  createEmptyModelUsage,
  estimateBlendedCostUsd,
  formatUsd,
  formatUsdCompact,
  mergeModelUsageMaps,
  shortenModelName,
  type ModelTokenUsage
} from './pricing'

/** Hard upper bound on plausible API USD value per 1% quota jump (~$10k/cycle, ~$42.8k/mo). */
export const MAX_SANE_USD_PER_PERCENT = 100
/** Statistical multiplier above window median $/1% to flag as spike outlier. */
export const OUTLIER_MEDIAN_MULTIPLIER = 5

/**
 * Filters model deltas to the specific quota bucket they consume
 * (e.g., Antigravity Gemini vs Claude/GPT vs Argon; Claude fableWeekly).
 */
export function filterModelsForWindow(
  provider: string,
  windowId: string,
  windowLabel: string,
  models: Record<string, ModelTokenUsage>
): Record<string, ModelTokenUsage> {
  if (provider === 'claude' && windowId === 'fableWeekly') {
    const out: Record<string, ModelTokenUsage> = {}
    for (const [model, usage] of Object.entries(models)) {
      if (/fable/i.test(model)) out[model] = usage
    }
    return out
  }

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

export { formatUsd, formatUsdCompact, shortenModelName, type ModelTokenUsage }

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

export type LedgerQuality = 'valid' | 'zero_cost' | 'outlier'

export interface LedgerEntryView extends LedgerEntry {
  quality: LedgerQuality
  qualityReason: string | null
  topModelsSummary: string
  modelBreakdown: ModelBreakdownItem[]
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
  version: 4
  lastPollAt: number | null
  lastError: string | null
  windows: Record<string, WindowTracker>
  ledger: LedgerEntry[]
  periodStats: Record<string, PeriodStat>
  sessionTokens: Record<string, StoredSessionBaseline>
  claudeFileOffsets: Record<string, number>
  antigravityFileOffsets: Record<string, number>
  recentClaudeMessageUsage: Record<string, MessageUsageWatermark>
  recentAntigravitySteps: string[]
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
  isMonthlyEligible: boolean
  resetCountdownText: string | null
  excludedOutlierCount: number
  tokensPerPercent: number | null
  estimated100PercentTokens: number | null
  usdPerPercent: number | null
  estimated100PercentUsd: number | null
  estimatedMonthlyUsd: number | null
  modelBreakdown: ModelBreakdownItem[]
}

export interface AccountGroupView {
  key: string
  provider: string
  providerName: string
  accountId: string
  accountLabel: string
  planType: string | null
  isActiveAccount: boolean
  windows: WindowSummaryView[]
  totalTrackedCostUsd: number
  totalTrackedTokens: number
  primaryMonthlyUsd: number | null
  excludedOutlierCount: number
  modelBreakdown: ModelBreakdownItem[]
}

export interface DashboardSummaryView {
  totalTrackedCostUsd: number
  totalTrackedTokens: number
  activeAccountCount: number
  totalAccountCount: number
  alertCount: number
  primaryMonthlyUsd: number | null
  primaryLabel: string | null
  primaryStatus: DriftStatus
  validLedgerCount: number
  excludedLedgerCount: number
}

export type DriftStatus = 'collecting' | 'stable' | 'watch' | 'degraded'

export interface TrendChartPoint {
  periodKey: string
  monthlyUsd: number
  usdPerPercent: number
  tokensPerPercent: number
  deltaPercent: number
  vsBaselinePercent: number | null
  topModelsSummary: string
}

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
  modelBreakdown: ModelBreakdownItem[]
  sampleCount: number
  excludedZeroCount: number
  excludedOutlierCount: number
  hasValidUsd: boolean
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
  excludedZeroCount: number
  excludedOutlierCount: number
  points: TrendChartPoint[]
}

export interface DashboardView {
  lastPollAt: number | null
  lastError: string | null
  nerfAlertDropPercent: number
  summary: DashboardSummaryView
  accounts: AccountGroupView[]
  windows: WindowSummaryView[]
  ledger: LedgerEntry[]
  ledgerViews: LedgerEntryView[]
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
    version: 4,
    lastPollAt: null,
    lastError: null,
    windows: {},
    ledger: [],
    periodStats: {},
    sessionTokens: {},
    claudeFileOffsets: {},
    antigravityFileOffsets: {},
    recentClaudeMessageUsage: {},
    recentAntigravitySteps: []
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

const MINUTES_PER_WEEK = 7 * 24 * 60 // 10,080 minutes (7 days)
const MINUTES_PER_MONTH = 30 * 24 * 60 // 43,200 minutes (30 days)

/** Returns true for weekly/monthly pacing windows; false for short burst windows like 5h sessions. */
export function isMonthlyValueEligibleWindow(
  windowMinutes: number | null | undefined,
  windowId: string,
  windowLabel: string
): boolean {
  return inferWindowMinutes(windowMinutes, windowId, windowLabel) >= MINUTES_PER_WEEK
}

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

/** Formats a human-readable relative countdown to a quota reset timestamp. */
export function formatResetCountdown(
  resetsAt: number | null | undefined,
  resetDescription: string | null | undefined,
  now = Date.now()
): string | null {
  if (typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > now) {
    const diffMin = Math.max(1, Math.round((resetsAt - now) / 60_000))
    if (diffMin >= 1440) {
      const days = Math.floor(diffMin / 1440)
      const hours = Math.floor((diffMin % 1440) / 60)
      return hours > 0 ? `${days}일 ${hours}시간 후` : `${days}일 후`
    }
    if (diffMin >= 60) {
      const hours = Math.floor(diffMin / 60)
      const mins = diffMin % 60
      return mins > 0 ? `${hours}시간 ${mins}분 후` : `${hours}시간 후`
    }
    return `${diffMin}분 후`
  }
  if (resetDescription && resetDescription.trim().length > 0) {
    return resetDescription.trim()
  }
  return null
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

/** Upgrades v1, v2, v3, or partial persisted state to v4 cleanly. */
export function migrateState(raw: unknown): TrackerState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return createEmptyState()
  }
  const obj = raw as Partial<TrackerState> & { version?: number }
  if (obj.version !== 1 && obj.version !== 2 && obj.version !== 3 && obj.version !== 4) {
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
  if (
    (obj.version === 2 || obj.version === 3 || obj.version === 4) &&
    obj.periodStats &&
    typeof obj.periodStats === 'object'
  ) {
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
    version: 4,
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
        : {},
    recentClaudeMessageUsage:
      obj.recentClaudeMessageUsage && typeof obj.recentClaudeMessageUsage === 'object'
        ? obj.recentClaudeMessageUsage
        : {},
    recentAntigravitySteps: Array.isArray(obj.recentAntigravitySteps)
      ? obj.recentAntigravitySteps.filter((x): x is string => typeof x === 'string')
      : []
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
      pushWindowIfPresent(samples, base, 'fableWeekly', 'Fable Weekly (7d)', rlObj.fableWeekly)
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
  if (next.usedPercent < prev.currentPercent - 2) {
    return true
  }
  if (prev.resetsAt !== null && next.resetsAt !== null) {
    const resetDeltaMs = next.resetsAt - prev.resetsAt
    // Ignore minor rolling-window jitter (<15m) unless usedPercent actually dropped.
    if (resetDeltaMs > 15 * 60 * 1000 && next.usedPercent <= prev.currentPercent) {
      return true
    }
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
  nextAntigravityFileOffsets?: Record<string, number>,
  nextClaudeMessageUsage?: Record<string, MessageUsageWatermark>,
  nextAntigravitySteps?: string[]
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
    const isFilteredBucket =
      sample.provider === 'antigravity' ||
      (sample.provider === 'claude' && sample.windowId === 'fableWeekly')
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
    version: 4,
    lastPollAt: now,
    lastError: null,
    windows: nextWindows,
    ledger: nextLedger.slice(0, maxLedgerEntries),
    periodStats: nextPeriodStats,
    sessionTokens: nextSessionTokens,
    claudeFileOffsets: nextClaudeFileOffsets ?? prevState.claudeFileOffsets,
    antigravityFileOffsets: nextAntigravityFileOffsets ?? prevState.antigravityFileOffsets,
    recentClaudeMessageUsage: nextClaudeMessageUsage ?? prevState.recentClaudeMessageUsage,
    recentAntigravitySteps: nextAntigravitySteps ?? prevState.recentAntigravitySteps
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Classifies every ledger entry as `valid`, `zero_cost` (legacy or external spend),
 * or `outlier` (historical backfill spike > $100/1% or > 5x series median).
 * Raw entries are never deleted; trend and summary calculations exclude non-valid entries.
 */
export function classifyLedgerEntries(ledger: LedgerEntry[]): LedgerEntryView[] {
  const saneRatesBySeries = new Map<string, number[]>()

  for (const e of ledger) {
    if (e.deltaCostUsd <= 0 || e.deltaPercent <= 0) continue
    const rate = e.usdPerPercent > 0 ? e.usdPerPercent : e.deltaCostUsd / e.deltaPercent
    if (rate > MAX_SANE_USD_PER_PERCENT) continue
    const seriesKey = `${e.provider}::${e.accountId}::${e.windowId}`
    const list = saneRatesBySeries.get(seriesKey) ?? []
    list.push(rate)
    saneRatesBySeries.set(seriesKey, list)
  }

  const medianBySeries = new Map<string, number>()
  for (const [seriesKey, rates] of saneRatesBySeries.entries()) {
    if (rates.length >= 4) {
      medianBySeries.set(seriesKey, median(rates))
    }
  }

  return ledger.map((e) => {
    const rate =
      e.deltaPercent > 0
        ? e.usdPerPercent > 0
          ? e.usdPerPercent
          : e.deltaCostUsd / e.deltaPercent
        : 0
    const seriesKey = `${e.provider}::${e.accountId}::${e.windowId}`
    const seriesMedian = medianBySeries.get(seriesKey)

    let quality: LedgerQuality = 'valid'
    let qualityReason: string | null = null

    if (e.deltaCostUsd <= 0) {
      quality = 'zero_cost'
      qualityReason =
        e.deltaTokens > 0 ? '과거 토큰 전용 기록 ($0)' : '로컬 로그 없음 ($0)'
    } else if (rate > MAX_SANE_USD_PER_PERCENT) {
      quality = 'outlier'
      qualityReason = `이상치 (${formatUsd(rate)}/1% > $${MAX_SANE_USD_PER_PERCENT} 상한)`
    } else if (
      seriesMedian !== undefined &&
      seriesMedian > 0 &&
      rate > seriesMedian * OUTLIER_MEDIAN_MULTIPLIER
    ) {
      quality = 'outlier'
      qualityReason = `이상치 (중앙값 ${formatUsd(seriesMedian)}/1% 대비 ${(rate / seriesMedian).toFixed(1)}배)`
    }

    return {
      ...e,
      quality,
      qualityReason,
      topModelsSummary: summarizeTopModels(e.models, 2),
      modelBreakdown: buildModelBreakdown(e.models)
    }
  })
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

interface EffectivePeriodBucket {
  stat: PeriodStat
  effectiveDeltaPercent: number
  effectiveDeltaTokens: number
  effectiveCostUsd: number
  effectiveModels: Record<string, ModelTokenUsage>
  effectiveSampleCount: number
  excludedZeroCount: number
  excludedOutlierCount: number
  hasValidUsd: boolean
}

function buildTrendsForGranularity(
  periodStats: Record<string, PeriodStat>,
  ledgerViews: LedgerEntryView[],
  periodType: PeriodGranularity,
  nerfAlertDropPercent: number
): { series: TrendSeriesSummary[]; rows: TrendPeriodRow[] } {
  // Index raw classified ledger entries by period key so we can compute outlier-free rollups
  const ledgerByPeriodKey = new Map<string, LedgerEntryView[]>()
  for (const entry of ledgerViews) {
    if (entry.deltaPercent <= 0) continue
    const pKey =
      periodType === 'week' ? getIsoWeekKey(entry.timestamp) : getMonthKey(entry.timestamp)
    const fullKey = `${periodType}::${pKey}::${entry.provider}::${entry.accountId}::${entry.windowId}`
    const list = ledgerByPeriodKey.get(fullKey) ?? []
    list.push(entry)
    ledgerByPeriodKey.set(fullKey, list)
  }

  const bySeries = new Map<string, EffectivePeriodBucket[]>()

  for (const stat of Object.values(periodStats)) {
    if (stat.periodType !== periodType || stat.totalDeltaPercent <= 0) continue
    // Exclude short-term burst windows (e.g. 5h) that are subordinate to weekly/monthly caps
    if (!isMonthlyValueEligibleWindow(stat.windowMinutes, stat.windowId, stat.windowLabel)) {
      continue
    }

    const rawEntries = ledgerByPeriodKey.get(stat.key)
    let bucket: EffectivePeriodBucket

    if (rawEntries && rawEntries.length > 0) {
      let validDeltaPct = 0
      let validTokens = 0
      let validCost = 0
      let validModels: Record<string, ModelTokenUsage> = {}
      let validCount = 0
      let zeroCount = 0
      let outlierCount = 0

      for (const e of rawEntries) {
        if (e.quality === 'zero_cost') {
          zeroCount++
        } else if (e.quality === 'outlier') {
          outlierCount++
        } else {
          validCount++
          validDeltaPct += e.deltaPercent
          validTokens += e.deltaTokens
          validCost += e.deltaCostUsd
          validModels = mergeModelUsageMaps(validModels, e.models)
        }
      }

      if (validCount > 0 && validDeltaPct > 0) {
        bucket = {
          stat,
          effectiveDeltaPercent: validDeltaPct,
          effectiveDeltaTokens: validTokens,
          effectiveCostUsd: validCost,
          effectiveModels: validModels,
          effectiveSampleCount: validCount,
          excludedZeroCount: zeroCount,
          excludedOutlierCount: outlierCount,
          hasValidUsd: validCost > 0
        }
      } else {
        // Period only had zero-cost or outlier entries
        bucket = {
          stat,
          effectiveDeltaPercent: stat.totalDeltaPercent,
          effectiveDeltaTokens: stat.totalDeltaTokens,
          effectiveCostUsd: 0,
          effectiveModels: {},
          effectiveSampleCount: stat.sampleCount,
          excludedZeroCount: zeroCount,
          excludedOutlierCount: outlierCount,
          hasValidUsd: false
        }
      }
    } else {
      // Historical period aged out of raw ledger: validate permanent periodStats sanity
      const rawUsdRate =
        stat.totalDeltaPercent > 0 ? stat.totalDeltaCostUsd / stat.totalDeltaPercent : 0
      const isOutlierRollup = rawUsdRate > MAX_SANE_USD_PER_PERCENT
      const hasValidUsd = stat.totalDeltaCostUsd > 0 && !isOutlierRollup
      bucket = {
        stat,
        effectiveDeltaPercent: stat.totalDeltaPercent,
        effectiveDeltaTokens: stat.totalDeltaTokens,
        effectiveCostUsd: hasValidUsd ? stat.totalDeltaCostUsd : 0,
        effectiveModels: hasValidUsd ? stat.models : {},
        effectiveSampleCount: stat.sampleCount,
        excludedZeroCount: stat.totalDeltaCostUsd <= 0 ? stat.sampleCount : 0,
        excludedOutlierCount: isOutlierRollup ? stat.sampleCount : 0,
        hasValidUsd
      }
    }

    const seriesKey = `${stat.provider}::${stat.accountId}::${stat.windowId}`
    const list = bySeries.get(seriesKey) ?? []
    list.push(bucket)
    bySeries.set(seriesKey, list)
  }

  const series: TrendSeriesSummary[] = []
  const rows: TrendPeriodRow[] = []

  for (const [seriesKey, allBuckets] of bySeries.entries()) {
    allBuckets.sort((a, b) => a.stat.periodKey.localeCompare(b.stat.periodKey))

    const usdBuckets = allBuckets.filter((b) => b.hasValidUsd)
    const useUsd = usdBuckets.length > 0
    // When USD data exists, ignore legacy $0 / outlier-only periods from trend series calculations
    const activeBuckets = useUsd ? usdBuckets : allBuckets.filter((b) => b.effectiveDeltaTokens > 0)
    if (activeBuckets.length === 0) continue

    const tokenRates = activeBuckets.map((b) =>
      b.effectiveDeltaPercent > 0
        ? Math.round(b.effectiveDeltaTokens / b.effectiveDeltaPercent)
        : 0
    )
    const usdRates = activeBuckets.map((b) =>
      b.effectiveDeltaPercent > 0 ? b.effectiveCostUsd / b.effectiveDeltaPercent : 0
    )
    const monthlyUsdRates = activeBuckets.map((b, idx) =>
      estimateMonthlyUsd(
        usdRates[idx],
        b.stat.windowMinutes,
        b.stat.windowId,
        b.stat.windowLabel
      )
    )

    const primaryRates = useUsd ? monthlyUsdRates : tokenRates
    const maxPrimary = Math.max(...primaryRates, 0)
    const baselinePrimary = primaryRates[0]

    const seriesRows: TrendPeriodRow[] = activeBuckets.map((b, idx) => {
      const s = b.stat
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
        totalDeltaPercent: b.effectiveDeltaPercent,
        totalDeltaTokens: b.effectiveDeltaTokens,
        totalDeltaCostUsd: b.effectiveCostUsd,
        tokensPerPercent: tRate,
        estimated100PercentTokens: tRate * 100,
        usdPerPercent: uRate,
        estimated100PercentUsd: uRate * 100,
        estimatedMonthlyUsd: mUsd,
        topModelsSummary: summarizeTopModels(b.effectiveModels, 2),
        modelBreakdown: buildModelBreakdown(b.effectiveModels),
        sampleCount: b.effectiveSampleCount,
        excludedZeroCount: b.excludedZeroCount,
        excludedOutlierCount: b.excludedOutlierCount,
        hasValidUsd: b.hasValidUsd,
        prevChangePercent: prevPrimary !== null ? pctChange(prevPrimary, pRate) : null,
        baselineChangePercent: idx > 0 ? pctChange(baselinePrimary, pRate) : null,
        bar: makeBar(pRate, maxPrimary)
      }
    })

    const latestBucket = activeBuckets[activeBuckets.length - 1]
    const latest = latestBucket.stat
    const latestTokenRate = tokenRates[tokenRates.length - 1]
    const latestUsdRate = usdRates[usdRates.length - 1]
    const latestMonthlyUsd = monthlyUsdRates[monthlyUsdRates.length - 1]
    const prevTokenRate = tokenRates.length >= 2 ? tokenRates[tokenRates.length - 2] : null
    const prevUsdRate = usdRates.length >= 2 ? usdRates[usdRates.length - 2] : null
    const prevMonthlyUsd =
      monthlyUsdRates.length >= 2 ? monthlyUsdRates[monthlyUsdRates.length - 2] : null
    const latestPrimary = primaryRates[primaryRates.length - 1]
    const prevPrimary = primaryRates.length >= 2 ? primaryRates[primaryRates.length - 2] : null

    const vsBaseline = activeBuckets.length >= 2 ? pctChange(baselinePrimary, latestPrimary) : null
    const vsPrevious = prevPrimary !== null ? pctChange(prevPrimary, latestPrimary) : null

    let status: DriftStatus = 'collecting'
    if (activeBuckets.length >= 2 && vsBaseline !== null) {
      if (vsBaseline <= -nerfAlertDropPercent && latestBucket.effectiveDeltaPercent >= 2) {
        status = 'degraded'
      } else if (vsBaseline <= -(nerfAlertDropPercent / 2)) {
        status = 'watch'
      } else {
        status = 'stable'
      }
    }

    const totalExcludedZero = allBuckets.reduce((sum, b) => sum + b.excludedZeroCount, 0)
    const totalExcludedOutlier = allBuckets.reduce((sum, b) => sum + b.excludedOutlierCount, 0)

    const points: TrendChartPoint[] = seriesRows.map((r) => ({
      periodKey: r.periodKey,
      monthlyUsd: r.estimatedMonthlyUsd,
      usdPerPercent: r.usdPerPercent,
      tokensPerPercent: r.tokensPerPercent,
      deltaPercent: r.totalDeltaPercent,
      vsBaselinePercent: r.baselineChangePercent,
      topModelsSummary: r.topModelsSummary
    }))

    series.push({
      seriesKey,
      periodType,
      provider: latest.provider,
      accountId: latest.accountId,
      accountLabel: latest.accountLabel,
      windowId: latest.windowId,
      windowLabel: latest.windowLabel,
      periodCount: activeBuckets.length,
      baselinePeriodKey: activeBuckets[0].stat.periodKey,
      baselineTokensPerPercent: tokenRates[0],
      baselineUsdPerPercent: usdRates[0],
      baselineMonthlyUsd: monthlyUsdRates[0],
      latestPeriodKey: latest.periodKey,
      latestTokensPerPercent: latestTokenRate,
      latestUsdPerPercent: latestUsdRate,
      latestMonthlyUsd,
      latestDeltaPercent: latestBucket.effectiveDeltaPercent,
      previousTokensPerPercent: prevTokenRate,
      previousUsdPerPercent: prevUsdRate,
      previousMonthlyUsd: prevMonthlyUsd,
      vsBaselinePercent: vsBaseline,
      vsPreviousPercent: vsPrevious,
      metricKind: useUsd ? 'usd' : 'tokens',
      status,
      excludedZeroCount: totalExcludedZero,
      excludedOutlierCount: totalExcludedOutlier,
      points
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
  nerfAlertDropPercent = 15,
  now = Date.now()
): DashboardView {
  const ledgerViews = classifyLedgerEntries(state.ledger)

  const ledgerByWindowKey = new Map<string, LedgerEntryView[]>()
  for (const e of ledgerViews) {
    const key = `${e.provider}::${e.accountId}::${e.windowId}`
    const list = ledgerByWindowKey.get(key) ?? []
    list.push(e)
    ledgerByWindowKey.set(key, list)
  }

  const windows: WindowSummaryView[] = Object.values(state.windows)
    .map((w) => {
      const isMonthlyEligible = isMonthlyValueEligibleWindow(
        w.windowMinutes,
        w.windowId,
        w.windowLabel
      )
      const resetCountdownText = formatResetCountdown(w.resetsAt, w.resetDescription, now)

      // Check if current window cycle contains outlier jumps in raw ledger
      const cycleEntries = (ledgerByWindowKey.get(w.key) ?? []).filter(
        (e) => e.timestamp >= w.firstSeenAt
      )
      const outlierEntries = cycleEntries.filter((e) => e.quality === 'outlier')
      const excludedOutlierCount = outlierEntries.length

      let effectiveDeltaPercent = w.trackedDeltaPercent
      let effectiveTokens = w.trackedTokens
      let effectiveCostUsd = w.trackedCostUsd
      let effectiveModels = w.trackedModels

      if (excludedOutlierCount > 0) {
        const validCycle = cycleEntries.filter((e) => e.quality === 'valid')
        let sumDelta = 0
        let sumTokens = w.pendingTokens
        let sumCost = w.pendingCostUsd
        let sumModels = mergeModelUsageMaps({}, w.pendingModels)
        for (const e of validCycle) {
          sumDelta += e.deltaPercent
          sumTokens += e.deltaTokens
          sumCost += e.deltaCostUsd
          sumModels = mergeModelUsageMaps(sumModels, e.models)
        }
        effectiveDeltaPercent = sumDelta
        effectiveTokens = sumTokens
        effectiveCostUsd = sumCost
        effectiveModels = sumModels
      }

      const tokensPerPercent =
        effectiveDeltaPercent > 0 ? Math.round(effectiveTokens / effectiveDeltaPercent) : null
      const estimated100PercentTokens =
        tokensPerPercent !== null ? tokensPerPercent * 100 : null

      // Compute $/1% from valid priced delta (excluding pending un-ticked spend when cycle has valid entries)
      let usdPerPercent: number | null = null
      if (excludedOutlierCount > 0) {
        const validCycle = cycleEntries.filter((e) => e.quality === 'valid')
        const validDelta = validCycle.reduce((s, e) => s + e.deltaPercent, 0)
        const validCost = validCycle.reduce((s, e) => s + e.deltaCostUsd, 0)
        usdPerPercent = validDelta > 0 && validCost > 0 ? validCost / validDelta : null
      } else if (effectiveDeltaPercent > 0 && effectiveCostUsd > 0) {
        const rawRate = effectiveCostUsd / effectiveDeltaPercent
        usdPerPercent = rawRate <= MAX_SANE_USD_PER_PERCENT ? rawRate : null
      }

      const estimated100PercentUsd = usdPerPercent !== null ? usdPerPercent * 100 : null
      const estimatedMonthlyUsd =
        usdPerPercent !== null && isMonthlyEligible
          ? estimateMonthlyUsd(usdPerPercent, w.windowMinutes, w.windowId, w.windowLabel)
          : null
      const modelBreakdown = buildModelBreakdown(effectiveModels)

      return {
        ...w,
        trackedDeltaPercent: effectiveDeltaPercent,
        trackedTokens: effectiveTokens,
        trackedCostUsd: effectiveCostUsd,
        trackedModels: effectiveModels,
        isMonthlyEligible,
        resetCountdownText,
        excludedOutlierCount,
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
      // Prefer pacing (weekly/monthly) windows first, then higher usage
      if (a.isMonthlyEligible !== b.isMonthlyEligible) return a.isMonthlyEligible ? -1 : 1
      if (b.currentPercent !== a.currentPercent) return b.currentPercent - a.currentPercent
      return (a.windowMinutes ?? 999999) - (b.windowMinutes ?? 999999)
    })

  // Group windows into AccountGroupView cards
  const accountMap = new Map<string, WindowSummaryView[]>()
  for (const w of windows) {
    const accKey = `${w.provider}::${w.accountId}`
    const list = accountMap.get(accKey) ?? []
    list.push(w)
    accountMap.set(accKey, list)
  }

  const accounts: AccountGroupView[] = Array.from(accountMap.entries())
    .map(([accKey, accWindows]) => {
      const first = accWindows[0]
      const isActiveAccount = accWindows.some((w) => w.isActiveAccount)
      // Avoid double-counting overlapping 5h + weekly windows: prefer disjoint pacing windows
      const pacingWindows = accWindows.filter(
        (w) => w.isMonthlyEligible && w.windowId !== 'fableWeekly'
      )
      const spendSourceWindows = pacingWindows.length > 0 ? pacingWindows : accWindows

      let totalTrackedCostUsd = 0
      let totalTrackedTokens = 0
      let combinedModels: Record<string, ModelTokenUsage> = {}
      let excludedOutlierCount = 0

      for (const w of spendSourceWindows) {
        totalTrackedCostUsd += w.trackedCostUsd
        totalTrackedTokens += w.trackedTokens
        combinedModels = mergeModelUsageMaps(combinedModels, w.trackedModels)
      }
      for (const w of accWindows) {
        excludedOutlierCount += w.excludedOutlierCount
      }

      const primaryWin =
        accWindows.find((w) => w.isMonthlyEligible && w.estimatedMonthlyUsd !== null) ?? null

      return {
        key: accKey,
        provider: first.provider,
        providerName: formatProviderName(first.provider),
        accountId: first.accountId,
        accountLabel: first.accountLabel,
        planType: first.planType,
        isActiveAccount,
        windows: accWindows,
        totalTrackedCostUsd,
        totalTrackedTokens,
        primaryMonthlyUsd: primaryWin?.estimatedMonthlyUsd ?? null,
        excludedOutlierCount,
        modelBreakdown: buildModelBreakdown(combinedModels)
      }
    })
    .sort((a, b) => {
      if (a.isActiveAccount !== b.isActiveAccount) return a.isActiveAccount ? -1 : 1
      if (b.totalTrackedCostUsd !== a.totalTrackedCostUsd) {
        return b.totalTrackedCostUsd - a.totalTrackedCostUsd
      }
      return a.accountLabel.localeCompare(b.accountLabel)
    })

  const weekly = buildTrendsForGranularity(
    state.periodStats,
    ledgerViews,
    'week',
    nerfAlertDropPercent
  )
  const monthly = buildTrendsForGranularity(
    state.periodStats,
    ledgerViews,
    'month',
    nerfAlertDropPercent
  )

  const degradedAlerts = [
    ...weekly.series.filter((s) => s.status === 'degraded'),
    ...monthly.series.filter((s) => s.status === 'degraded')
  ]

  const primary =
    windows.find(
      (w) =>
        w.isActiveAccount &&
        w.estimatedMonthlyUsd !== null &&
        w.isMonthlyEligible
    ) ??
    windows.find((w) => w.isActiveAccount && w.trackedDeltaPercent > 0) ??
    windows.find((w) => w.isActiveAccount) ??
    windows[0]

  const primarySeries = primary
    ? weekly.series.find((s) => s.seriesKey === primary.key) ??
      monthly.series.find((s) => s.seriesKey === primary.key)
    : undefined

  const validLedgerCount = ledgerViews.filter((e) => e.quality === 'valid').length
  const summary: DashboardSummaryView = {
    totalTrackedCostUsd: accounts.reduce((sum, a) => sum + a.totalTrackedCostUsd, 0),
    totalTrackedTokens: accounts.reduce((sum, a) => sum + a.totalTrackedTokens, 0),
    activeAccountCount: accounts.filter((a) => a.isActiveAccount).length,
    totalAccountCount: accounts.length,
    alertCount: degradedAlerts.length,
    primaryMonthlyUsd: primary?.estimatedMonthlyUsd ?? primarySeries?.latestMonthlyUsd ?? null,
    primaryLabel: primary ? `${formatProviderName(primary.provider)}` : null,
    primaryStatus: primarySeries?.status ?? 'collecting',
    validLedgerCount,
    excludedLedgerCount: ledgerViews.length - validLedgerCount
  }

  let statusBarText = 'Token Tracker'
  let statusBarTooltip = '계정별 사용량 및 추정 월간 달러 가치($/월) 감시'
  let statusBarTone: DashboardView['statusBarTone'] = 'neutral'

  if (primary) {
    const providerShort = formatProviderName(primary.provider)
    const ratePart =
      primary.estimatedMonthlyUsd !== null
        ? ` · ~${formatUsdCompact(primary.estimatedMonthlyUsd)}/월`
        : primary.trackedCostUsd > 0
          ? ` · +${formatUsdCompact(primary.trackedCostUsd)}`
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
    summary,
    accounts,
    windows,
    ledger: state.ledger,
    ledgerViews,
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
  const views = classifyLedgerEntries(ledger)
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
    'quality',
    'models',
    'sessions'
  ].join(',')

  const escape = (v: string | number): string => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows = views.map((e) =>
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
      e.quality,
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
    'samples',
    'excluded_zero',
    'excluded_outlier'
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
      r.sampleCount,
      r.excludedZeroCount,
      r.excludedOutlierCount
    ]
      .map(escape)
      .join(',')
  )

  return [header, ...lines].join('\n')
}
