import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import {
  scanAntigravityLocalDeltas,
  type AntigravityDeltaScanResult
} from './antigravity-logs'
import { scanClaudeLocalDeltas, type ClaudeDeltaScanResult } from './claude-logs'
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
  type ModelTokenUsage,
  type QuotaWindowSample,
  type SessionRecord,
  type TrackerState
} from './model'
import { parseCustomPricing, type CustomPricingOverrides } from './pricing'

const execFileAsync = promisify(execFile)

const STATE_KEY = 'trackerState'
const DEFAULT_POLL_SEC = 60
const DEFAULT_MAX_LEDGER = 300
const DEFAULT_NERF_ALERT_DROP = 15

/** Strips any `undefined` keys or non-finite numbers so Orca's strict JSON validator always accepts the payload. */
function toPlainJson<T>(value: T): Record<string, never> {
  return JSON.parse(JSON.stringify(value)) as Record<string, never>
}

export type AccountListFetcher = () => Promise<QuotaWindowSample[]>
export type LocalClaudeDeltaFetcher = (
  prevOffsets: Record<string, number>,
  isBaseline: boolean,
  lastPollAt: number | null,
  overrides?: CustomPricingOverrides
) => ClaudeDeltaScanResult

export type LocalAntigravityDeltaFetcher = (
  prevOffsets: Record<string, number>,
  isBaseline: boolean,
  lastPollAt: number | null,
  overrides?: CustomPricingOverrides
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
  const raw = await orca.storage.get(STATE_KEY)
  return migrateState(raw)
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
}> {
  const isBaseline = prevState.lastPollAt === null

  let claudeDelta: ClaudeDeltaScanResult = {
    nextOffsets: prevState.claudeFileOffsets,
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
          customPricing
        )
      : scanClaudeLocalDeltas(
          prevState.claudeFileOffsets,
          isBaseline,
          prevState.lastPollAt,
          customPricing
        )
  } catch (err) {
    orca.log(`scanClaudeLocalDeltas failed: ${String(err)}`)
  }

  let agDelta: AntigravityDeltaScanResult = {
    nextOffsets: prevState.antigravityFileOffsets,
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
          customPricing
        )
      : scanAntigravityLocalDeltas(
          prevState.antigravityFileOffsets,
          isBaseline,
          prevState.lastPollAt,
          customPricing
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
    nextAntigravityOffsets: agDelta.nextOffsets
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
        usageData.nextAntigravityOffsets
      )
      await orca.storage.set(STATE_KEY, toPlainJson(next))
      const view = buildDashboardView(next, nerfAlertDropPercent)
      await updateStatusBar(orca, view)
      orca.panels.post('tracker.updated', toPlainJson(view))
      return view
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      orca.log(`snapshot failed: ${message}`)
      const errored: TrackerState = { ...prev, lastError: message }
      await orca.storage.set(STATE_KEY, toPlainJson(errored))
      const view = buildDashboardView(errored, nerfAlertDropPercent)
      orca.panels.post('tracker.updated', toPlainJson(view))
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
    return buildDashboardView(state, nerfAlertDropPercent) as unknown as Record<string, never>
  })

  orca.panels.handle('tracker.refresh', async () => {
    return (await runRefresh(orca)) as unknown as Record<string, never>
  })

  orca.panels.handle('tracker.reset', async () => {
    const empty = createEmptyState()
    const { nerfAlertDropPercent } = await readSettings(orca)
    await orca.storage.set(STATE_KEY, empty as unknown as Record<string, never>)
    const view = buildDashboardView(empty, nerfAlertDropPercent)
    await updateStatusBar(orca, view)
    orca.panels.post('tracker.updated', view as unknown as Record<string, never>)
    return view as unknown as Record<string, never>
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
      orca.panels.post('tracker.updated', view as unknown as Record<string, never>)
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
