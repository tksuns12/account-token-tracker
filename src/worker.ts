import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import {
  scanAntigravityLocalDeltas,
  type AntigravityDeltaScanResult
} from './antigravity-logs'
import {
  scanClaudeLocalDeltas,
  type ClaudeDeltaScanResult,
  type MessageUsageWatermark
} from './claude-logs'
import {
  applySnapshot,
  buildDashboardView,
  buildLedgerCsv,
  buildTrendsCsv,
  createEmptyState,
  migrateState,
  normalizeAgentToProvider,
  parseAccountListResponse,
  type DashboardView,
  type LedgerEntry,
  type ModelTokenUsage,
  type QuotaWindowSample,
  type SessionRecord,
  type StoredSessionBaseline,
  type TrackerState
} from './model'
import { parseCustomPricing, type CustomPricingOverrides } from './pricing'

const execFileAsync = promisify(execFile)

// Orca enforces a 256 KiB (262,144 byte) limit per storage key and per panel post.
const MAX_JSON_BYTES = 220_000
const LEGACY_STATE_KEY = 'trackerState'
const CORE_KEY = 'trackerCore'
const LEDGER_KEY = 'trackerLedger'
const SESSIONS_KEY = 'trackerSessions'
const CURSORS_KEY = 'trackerLogCursors'

const DEFAULT_POLL_SEC = 60
const DEFAULT_MAX_LEDGER = 300
const DEFAULT_NERF_ALERT_DROP = 15

/** Strips any `undefined` keys or non-finite numbers so Orca's strict JSON validator always accepts the payload. */
function toPlainJson<T>(value: T): Record<string, never> {
  return JSON.parse(JSON.stringify(value)) as Record<string, never>
}

function jsonByteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function fitArrayToByteLimit<T>(items: T[], maxBytes: number): T[] {
  if (items.length === 0 || jsonByteSize(items) <= maxBytes) return items
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (jsonByteSize(items.slice(0, mid)) <= maxBytes) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return items.slice(0, lo)
}

function trimSessionsForStorage(
  sessions: Record<string, StoredSessionBaseline>,
  maxBytes: number
): Record<string, StoredSessionBaseline> {
  const entries = Object.entries(sessions).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  let limit = Math.min(entries.length, 300)
  while (limit > 0) {
    const subset = Object.fromEntries(entries.slice(0, limit))
    if (jsonByteSize(subset) <= maxBytes) return subset
    limit = Math.floor(limit * 0.7)
  }
  return {}
}

function trimCursorsForStorage(
  state: TrackerState,
  maxBytes: number
): {
  claudeFileOffsets: Record<string, number>
  antigravityFileOffsets: Record<string, number>
  recentClaudeMessageUsage: Record<string, MessageUsageWatermark>
  recentAntigravitySteps: string[]
} {
  let claudeOffsets = state.claudeFileOffsets
  let agOffsets = state.antigravityFileOffsets
  let msgUsage = state.recentClaudeMessageUsage
  let agSteps = state.recentAntigravitySteps

  const build = () => ({
    claudeFileOffsets: claudeOffsets,
    antigravityFileOffsets: agOffsets,
    recentClaudeMessageUsage: msgUsage,
    recentAntigravitySteps: agSteps
  })

  if (jsonByteSize(build()) <= maxBytes) return build()

  // First trim message watermarks & step caches, then file offset counts if still oversized
  const msgKeys = Object.keys(msgUsage)
  if (msgKeys.length > 80) {
    msgUsage = Object.fromEntries(msgKeys.slice(-80).map((k) => [k, msgUsage[k]]))
  }
  if (agSteps.length > 80) {
    agSteps = agSteps.slice(-80)
  }
  if (jsonByteSize(build()) <= maxBytes) return build()

  const claudeEntries = Object.entries(claudeOffsets)
  if (claudeEntries.length > 150) {
    claudeOffsets = Object.fromEntries(claudeEntries.slice(0, 150))
  }
  const agEntries = Object.entries(agOffsets)
  if (agEntries.length > 100) {
    agOffsets = Object.fromEntries(agEntries.slice(0, 100))
  }
  if (jsonByteSize(build()) <= maxBytes) return build()

  msgUsage = {}
  agSteps = []
  return build()
}

/** Builds a compact, <256 KiB panel payload by removing duplicate raw maps the UI does not read. */
export function toPanelPayload(view: DashboardView): Record<string, never> {
  const compactWindows = view.windows.map((w) => ({
    ...w,
    trackedModels: {},
    pendingModels: {}
  }))

  const compactAccounts = view.accounts.map((acc) => ({
    ...acc,
    windows: acc.windows.map((w) => ({
      ...w,
      trackedModels: {},
      pendingModels: {}
    }))
  }))

  const compactLedgerViews = view.ledgerViews.map((e) => ({
    ...e,
    models: {}
  }))

  const basePayload = {
    ...view,
    windows: compactWindows,
    accounts: compactAccounts,
    ledger: [] as LedgerEntry[],
    ledgerViews: compactLedgerViews
  }

  if (jsonByteSize(basePayload) <= MAX_JSON_BYTES) {
    return toPlainJson(basePayload)
  }

  // Reserve space for everything except ledgerViews and trim oldest ledgerViews if needed
  const overhead = jsonByteSize({ ...basePayload, ledgerViews: [] })
  const budget = Math.max(16_000, MAX_JSON_BYTES - overhead)
  return toPlainJson({
    ...basePayload,
    ledgerViews: fitArrayToByteLimit(compactLedgerViews, budget)
  })
}

export type AccountListFetcher = () => Promise<QuotaWindowSample[]>
export type LocalClaudeDeltaFetcher = (
  prevOffsets: Record<string, number>,
  isBaseline: boolean,
  lastPollAt: number | null,
  overrides?: CustomPricingOverrides,
  prevMessageUsage?: Record<string, MessageUsageWatermark>
) => ClaudeDeltaScanResult

export type LocalAntigravityDeltaFetcher = (
  prevOffsets: Record<string, number>,
  isBaseline: boolean,
  lastPollAt: number | null,
  overrides?: CustomPricingOverrides,
  prevSeenSteps?: string[]
) => AntigravityDeltaScanResult

let customFetcher: AccountListFetcher | null = null
let customClaudeDeltaFetcher: LocalClaudeDeltaFetcher | null = null
let customAntigravityDeltaFetcher: LocalAntigravityDeltaFetcher | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let inFlightRefresh: Promise<DashboardView> | null = null
let deactivated = false

/** Allows unit tests to inject a mock account list fetcher instead of spawning `orca`. */
export function setAccountListFetcherForTests(fetcher: AccountListFetcher | null): void {
  customFetcher = fetcher
}

/** Allows unit tests to inject a mock incremental Claude JSONL scanner. */
export function setClaudeDeltaFetcherForTests(fetcher: LocalClaudeDeltaFetcher | null): void {
  customClaudeDeltaFetcher = fetcher
}

/** Allows unit tests to inject a mock incremental Antigravity transcript scanner. */
export function setAntigravityDeltaFetcherForTests(
  fetcher: LocalAntigravityDeltaFetcher | null
): void {
  customAntigravityDeltaFetcher = fetcher
}

async function fetchAccountQuotasFromCli(): Promise<QuotaWindowSample[]> {
  if (customFetcher) return customFetcher()
  const bin = process.env.ORCA_CLI_COMMAND || 'orca'
  const { stdout } = await execFileAsync(bin, ['account', 'list', '--json'], {
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024
  })
  const parsed: unknown = JSON.parse(stdout)
  return parseAccountListResponse(parsed)
}

async function loadState(orca: OrcaWorkerApi): Promise<TrackerState> {
  const core = await orca.storage.get(CORE_KEY)
  if (core && typeof core === 'object' && !Array.isArray(core)) {
    const [ledger, sessions, cursors] = await Promise.all([
      orca.storage.get(LEDGER_KEY),
      orca.storage.get(SESSIONS_KEY),
      orca.storage.get(CURSORS_KEY)
    ])
    const cObj =
      cursors && typeof cursors === 'object' && !Array.isArray(cursors)
        ? (cursors as Record<string, unknown>)
        : {}
    return migrateState({
      ...(core as Record<string, unknown>),
      ledger: Array.isArray(ledger) ? ledger : [],
      sessionTokens:
        sessions && typeof sessions === 'object' && !Array.isArray(sessions) ? sessions : {},
      claudeFileOffsets: cObj.claudeFileOffsets ?? {},
      antigravityFileOffsets: cObj.antigravityFileOffsets ?? {},
      recentClaudeMessageUsage: cObj.recentClaudeMessageUsage ?? {},
      recentAntigravitySteps: cObj.recentAntigravitySteps ?? []
    })
  }

  // Backward-compatible migration from legacy single-key `trackerState`
  const legacyRaw = await orca.storage.get(LEGACY_STATE_KEY)
  return migrateState(legacyRaw)
}

async function saveState(orca: OrcaWorkerApi, state: TrackerState): Promise<void> {
  const core = {
    version: state.version,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    windows: state.windows,
    periodStats: state.periodStats
  }
  const ledger = fitArrayToByteLimit(state.ledger, MAX_JSON_BYTES)
  const sessions = trimSessionsForStorage(state.sessionTokens, MAX_JSON_BYTES)
  const cursors = trimCursorsForStorage(state, MAX_JSON_BYTES)

  await Promise.all([
    orca.storage.set(CORE_KEY, toPlainJson(core)),
    orca.storage.set(LEDGER_KEY, toPlainJson(ledger)),
    orca.storage.set(SESSIONS_KEY, toPlainJson(sessions)),
    orca.storage.set(CURSORS_KEY, toPlainJson(cursors))
  ])

  // Clean up legacy single-key blob once sharded keys succeed
  try {
    await orca.storage.delete(LEGACY_STATE_KEY)
  } catch {
    // Ignore if already absent
  }
}

async function saveCoreError(
  orca: OrcaWorkerApi,
  prev: TrackerState,
  message: string
): Promise<TrackerState> {
  const errored: TrackerState = { ...prev, lastError: message }
  try {
    await orca.storage.set(
      CORE_KEY,
      toPlainJson({
        version: errored.version,
        lastPollAt: errored.lastPollAt,
        lastError: errored.lastError,
        windows: errored.windows,
        periodStats: errored.periodStats
      })
    )
  } catch (err) {
    orca.log(`saveCoreError failed: ${String(err)}`)
  }
  return errored
}

async function readSettings(orca: OrcaWorkerApi): Promise<{
  pollIntervalSec: number
  maxLedgerEntries: number
  nerfAlertDropPercent: number
  customPricing: CustomPricingOverrides
}> {
  try {
    const all = await orca.settings.get()
    const poll =
      typeof all.pollIntervalSec === 'number' && all.pollIntervalSec >= 15
        ? all.pollIntervalSec
        : DEFAULT_POLL_SEC
    const maxLedger =
      typeof all.maxLedgerEntries === 'number' && all.maxLedgerEntries >= 50
        ? all.maxLedgerEntries
        : DEFAULT_MAX_LEDGER
    const nerfDrop =
      typeof all.nerfAlertDropPercent === 'number' && all.nerfAlertDropPercent >= 5
        ? all.nerfAlertDropPercent
        : DEFAULT_NERF_ALERT_DROP
    const customPricing = parseCustomPricing(all.customPricingJson)
    return {
      pollIntervalSec: poll,
      maxLedgerEntries: maxLedger,
      nerfAlertDropPercent: nerfDrop,
      customPricing
    }
  } catch {
    return {
      pollIntervalSec: DEFAULT_POLL_SEC,
      maxLedgerEntries: DEFAULT_MAX_LEDGER,
      nerfAlertDropPercent: DEFAULT_NERF_ALERT_DROP,
      customPricing: {}
    }
  }
}

async function updateStatusBar(orca: OrcaWorkerApi, view: DashboardView): Promise<void> {
  try {
    await orca.host.call('statusBar.update', {
      id: 'token-tracker',
      text: view.statusBarText,
      tooltip: view.statusBarTooltip,
      tone: view.statusBarTone
    })
  } catch {
    // Status bar may be unavailable in headless or test environments.
  }
}

async function collectUsageData(
  orca: OrcaWorkerApi,
  prevState: TrackerState,
  customPricing: CustomPricingOverrides
): Promise<{
  sessions: SessionRecord[]
  directProviderDeltas: Record<string, Record<string, ModelTokenUsage>>
  nextClaudeOffsets: Record<string, number>
  nextAntigravityOffsets: Record<string, number>
  nextClaudeMessageUsage: Record<string, MessageUsageWatermark>
  nextAntigravitySteps: string[]
}> {
  const isBaseline = prevState.lastPollAt === null

  let claudeDelta: ClaudeDeltaScanResult = {
    nextOffsets: prevState.claudeFileOffsets,
    nextMessageUsage: prevState.recentClaudeMessageUsage,
    deltaModels: {},
    deltaTokens: 0,
    deltaCostUsd: 0,
    hasLocalLogs: false
  }
  try {
    claudeDelta = customClaudeDeltaFetcher
      ? customClaudeDeltaFetcher(
          prevState.claudeFileOffsets,
          isBaseline,
          prevState.lastPollAt,
          customPricing,
          prevState.recentClaudeMessageUsage
        )
      : scanClaudeLocalDeltas(
          prevState.claudeFileOffsets,
          isBaseline,
          prevState.lastPollAt,
          customPricing,
          { prevMessageUsage: prevState.recentClaudeMessageUsage }
        )
  } catch (err) {
    orca.log(`scanClaudeLocalDeltas failed: ${String(err)}`)
  }

  let agDelta: AntigravityDeltaScanResult = {
    nextOffsets: prevState.antigravityFileOffsets,
    nextSeenSteps: prevState.recentAntigravitySteps,
    deltaModels: {},
    deltaTokens: 0,
    deltaCostUsd: 0,
    hasLocalLogs: false
  }
  try {
    agDelta = customAntigravityDeltaFetcher
      ? customAntigravityDeltaFetcher(
          prevState.antigravityFileOffsets,
          isBaseline,
          prevState.lastPollAt,
          customPricing,
          prevState.recentAntigravitySteps
        )
      : scanAntigravityLocalDeltas(
          prevState.antigravityFileOffsets,
          isBaseline,
          prevState.lastPollAt,
          customPricing,
          { prevSeenSteps: prevState.recentAntigravitySteps }
        )
  } catch (err) {
    orca.log(`scanAntigravityLocalDeltas failed: ${String(err)}`)
  }

  const directProviderDeltas: Record<string, Record<string, ModelTokenUsage>> = {}
  if (Object.keys(claudeDelta.deltaModels).length > 0) {
    directProviderDeltas.claude = claudeDelta.deltaModels
  }
  if (Object.keys(agDelta.deltaModels).length > 0) {
    directProviderDeltas.antigravity = agDelta.deltaModels
  }

  const sessions: SessionRecord[] = []
  if (orca.host.has('agent.listSessions')) {
    try {
      const res = await orca.host.call('agent.listSessions', { limit: 200 })
      for (const s of res.sessions) {
        const prov = normalizeAgentToProvider(s.agent)
        if (claudeDelta.hasLocalLogs && prov === 'claude') continue
        if (agDelta.hasLocalLogs && prov === 'antigravity') continue
        sessions.push({
          sessionId: s.sessionId,
          agent: s.agent,
          title: s.title,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
          totalTokens: s.totalTokens
        })
      }
    } catch (err) {
      orca.log(`agent.listSessions failed: ${String(err)}`)
    }
  }

  return {
    sessions,
    directProviderDeltas,
    nextClaudeOffsets: claudeDelta.nextOffsets,
    nextAntigravityOffsets: agDelta.nextOffsets,
    nextClaudeMessageUsage: claudeDelta.nextMessageUsage ?? prevState.recentClaudeMessageUsage,
    nextAntigravitySteps: agDelta.nextSeenSteps ?? prevState.recentAntigravitySteps
  }
}

async function runRefresh(orca: OrcaWorkerApi): Promise<DashboardView> {
  if (inFlightRefresh) return inFlightRefresh
  inFlightRefresh = (async () => {
    const prev = await loadState(orca)
    const { maxLedgerEntries, nerfAlertDropPercent, customPricing } = await readSettings(orca)
    const now = Date.now()
    try {
      const [quotas, usageData] = await Promise.all([
        fetchAccountQuotasFromCli(),
        collectUsageData(orca, prev, customPricing)
      ])
      const next = applySnapshot(
        prev,
        quotas,
        usageData.sessions,
        now,
        maxLedgerEntries,
        usageData.directProviderDeltas,
        usageData.nextClaudeOffsets,
        usageData.nextAntigravityOffsets,
        usageData.nextClaudeMessageUsage,
        usageData.nextAntigravitySteps
      )
      await saveState(orca, next)
      const view = buildDashboardView(next, nerfAlertDropPercent, now)
      await updateStatusBar(orca, view)
      orca.panels.post('tracker.updated', toPanelPayload(view))
      return view
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      orca.log(`snapshot failed: ${message}`)
      const errored = await saveCoreError(orca, prev, message)
      const view = buildDashboardView(errored, nerfAlertDropPercent, now)
      orca.panels.post('tracker.updated', toPanelPayload(view))
      return view
    } finally {
      inFlightRefresh = null
    }
  })()
  return inFlightRefresh
}

function scheduleDebouncedRefresh(orca: OrcaWorkerApi, delayMs = 3000): void {
  if (deactivated) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (!deactivated) void runRefresh(orca)
  }, delayMs)
  debounceTimer.unref?.()
}

export default function activate(orca: OrcaWorkerApi): void {
  deactivated = false

  orca.panels.handle('tracker.get', async () => {
    const [state, { nerfAlertDropPercent }] = await Promise.all([
      loadState(orca),
      readSettings(orca)
    ])
    return toPanelPayload(buildDashboardView(state, nerfAlertDropPercent))
  })

  orca.panels.handle('tracker.refresh', async () => {
    return toPanelPayload(await runRefresh(orca))
  })

  orca.panels.handle('tracker.reset', async () => {
    const empty = createEmptyState()
    const { nerfAlertDropPercent } = await readSettings(orca)
    await saveState(orca, empty)
    const view = buildDashboardView(empty, nerfAlertDropPercent)
    await updateStatusBar(orca, view)
    const payload = toPanelPayload(view)
    orca.panels.post('tracker.updated', payload)
    return payload
  })

  orca.panels.handle('tracker.exportCsv', async () => {
    const state = await loadState(orca)
    const stamp = new Date().toISOString().slice(0, 10)
    return {
      filename: `orca-account-tokens-ledger-${stamp}.csv`,
      csv: buildLedgerCsv(state.ledger)
    }
  })

  orca.panels.handle('tracker.exportTrendsCsv', async ({ granularity }) => {
    const [state, { nerfAlertDropPercent }] = await Promise.all([
      loadState(orca),
      readSettings(orca)
    ])
    const view = buildDashboardView(state, nerfAlertDropPercent)
    const rows = granularity === 'month' ? view.monthlyRows : view.weeklyRows
    const stamp = new Date().toISOString().slice(0, 10)
    return {
      filename: `orca-token-trends-${granularity}-${stamp}.csv`,
      csv: buildTrendsCsv(rows)
    }
  })

  orca.commands.register('refresh', async () => {
    const view = await runRefresh(orca)
    return view.statusBarText
  })

  orca.events.on('agent.status.changed', (payload) => {
    if (payload.state === 'done' || payload.state === 'waiting') {
      scheduleDebouncedRefresh(orca, 2500)
    }
  })

  const startPolling = async (): Promise<void> => {
    if (pollTimer) clearInterval(pollTimer)
    if (deactivated) return
    const { pollIntervalSec } = await readSettings(orca)
    if (deactivated) return
    pollTimer = setInterval(() => {
      if (!deactivated) void runRefresh(orca)
    }, pollIntervalSec * 1000)
    pollTimer.unref?.()
  }

  orca.settings.onDidChange(async ({ key }) => {
    if (key === 'pollIntervalSec') {
      void startPolling()
    } else if (key === 'nerfAlertDropPercent' || key === 'customPricingJson') {
      const [state, { nerfAlertDropPercent }] = await Promise.all([
        loadState(orca),
        readSettings(orca)
      ])
      const view = buildDashboardView(state, nerfAlertDropPercent)
      await updateStatusBar(orca, view)
      orca.panels.post('tracker.updated', toPanelPayload(view))
    }
  })

  void loadState(orca).then(async (state) => {
    if (deactivated) return
    const { nerfAlertDropPercent } = await readSettings(orca)
    await updateStatusBar(orca, buildDashboardView(state, nerfAlertDropPercent))
    await startPolling()
    if (!deactivated) void runRefresh(orca)
  })
}

export function deactivate(): void {
  deactivated = true
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}
