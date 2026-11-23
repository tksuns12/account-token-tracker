import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  computeUsageCostUsd,
  createEmptyModelUsage,
  mergeModelUsageMaps,
  type CustomPricingOverrides,
  type ModelTokenUsage
} from './pricing'

export interface MessageUsageWatermark {
  model: string
  inputTokens: number
  outputTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
  cacheReadTokens: number
}

export interface ClaudeDeltaScanResult {
  nextOffsets: Record<string, number>
  nextMessageUsage: Record<string, MessageUsageWatermark>
  deltaModels: Record<string, ModelTokenUsage>
  deltaTokens: number
  deltaCostUsd: number
  hasLocalLogs: boolean
}

const MAX_RECENT_MESSAGES = 250

function asNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

function parseIsoMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.length > 0) {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function pruneWatermarkMap(
  map: Record<string, MessageUsageWatermark>
): Record<string, MessageUsageWatermark> {
  const keys = Object.keys(map)
  if (keys.length <= MAX_RECENT_MESSAGES) return map
  const keep = keys.slice(keys.length - MAX_RECENT_MESSAGES)
  const out: Record<string, MessageUsageWatermark> = {}
  for (const k of keep) {
    out[k] = map[k]
  }
  return out
}

export interface ClaudeParseOptions {
  /** Skip records whose ISO timestamp is strictly older than this epoch ms. */
  sinceMs?: number | null
  /** Previously counted per-message watermarks to prevent cross-poll streaming double counts. */
  prevMessageUsage?: Record<string, MessageUsageWatermark>
}

/**
 * Parses a Claude Code session JSONL chunk into per-model token deltas,
 * deduplicating both within the chunk and across polls via `message.id` watermarks.
 */
export function parseClaudeJsonlIncremental(
  content: string,
  overrides?: CustomPricingOverrides,
  options?: ClaudeParseOptions
): {
  models: Record<string, ModelTokenUsage>
  nextMessageUsage: Record<string, MessageUsageWatermark>
} {
  const prevWatermarks = options?.prevMessageUsage ?? {}
  const nextWatermarks: Record<string, MessageUsageWatermark> = { ...prevWatermarks }
  const sinceMs = typeof options?.sinceMs === 'number' && Number.isFinite(options.sinceMs)
    ? options.sinceMs
    : null

  const byMessageId = new Map<string, MessageUsageWatermark>()

  let anonSeq = 0
  const lines = content.split('\n')
  for (const line of lines) {
    if (!line.includes('"usage"')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const rec = parsed as {
      timestamp?: unknown
      message?: {
        id?: unknown
        model?: unknown
        usage?: {
          input_tokens?: unknown
          output_tokens?: unknown
          cache_creation_input_tokens?: unknown
          cache_read_input_tokens?: unknown
          cache_creation?: {
            ephemeral_5m_input_tokens?: unknown
            ephemeral_1h_input_tokens?: unknown
          }
        }
      }
    }

    if (sinceMs !== null) {
      const recMs = parseIsoMs(rec.timestamp)
      if (recMs !== null && recMs < sinceMs) continue
    }

    const msg = rec.message
    const usage = msg?.usage
    const model = typeof msg?.model === 'string' ? msg.model.trim() : ''
    if (!usage || !model || model === '<synthetic>') continue

    const inputTokens = asNonNegInt(usage.input_tokens)
    const outputTokens = asNonNegInt(usage.output_tokens)
    const cacheReadTokens = asNonNegInt(usage.cache_read_input_tokens)

    let cacheWrite5mTokens = asNonNegInt(usage.cache_creation?.ephemeral_5m_input_tokens)
    let cacheWrite1hTokens = asNonNegInt(usage.cache_creation?.ephemeral_1h_input_tokens)
    const totalCacheCreation = asNonNegInt(usage.cache_creation_input_tokens)
    if (cacheWrite5mTokens === 0 && cacheWrite1hTokens === 0 && totalCacheCreation > 0) {
      cacheWrite5mTokens = totalCacheCreation
    }

    const key = typeof msg?.id === 'string' && msg.id.length > 0 ? msg.id : `anon-${++anonSeq}`
    const prevInChunk = byMessageId.get(key)
    byMessageId.set(key, {
      model,
      inputTokens: Math.max(prevInChunk?.inputTokens ?? 0, inputTokens),
      outputTokens: Math.max(prevInChunk?.outputTokens ?? 0, outputTokens),
      cacheWrite5mTokens: Math.max(prevInChunk?.cacheWrite5mTokens ?? 0, cacheWrite5mTokens),
      cacheWrite1hTokens: Math.max(prevInChunk?.cacheWrite1hTokens ?? 0, cacheWrite1hTokens),
      cacheReadTokens: Math.max(prevInChunk?.cacheReadTokens ?? 0, cacheReadTokens)
    })
  }

  const models: Record<string, ModelTokenUsage> = {}
  for (const [key, item] of byMessageId.entries()) {
    const isAnon = key.startsWith('anon-')
    const prev = isAnon ? undefined : prevWatermarks[key]

    const dIn = Math.max(0, item.inputTokens - (prev?.inputTokens ?? 0))
    const dOut = Math.max(0, item.outputTokens - (prev?.outputTokens ?? 0))
    const dCw5 = Math.max(0, item.cacheWrite5mTokens - (prev?.cacheWrite5mTokens ?? 0))
    const dCw1 = Math.max(0, item.cacheWrite1hTokens - (prev?.cacheWrite1hTokens ?? 0))
    const dCr = Math.max(0, item.cacheReadTokens - (prev?.cacheReadTokens ?? 0))

    if (!isAnon) {
      nextWatermarks[key] = {
        model: item.model,
        inputTokens: Math.max(prev?.inputTokens ?? 0, item.inputTokens),
        outputTokens: Math.max(prev?.outputTokens ?? 0, item.outputTokens),
        cacheWrite5mTokens: Math.max(prev?.cacheWrite5mTokens ?? 0, item.cacheWrite5mTokens),
        cacheWrite1hTokens: Math.max(prev?.cacheWrite1hTokens ?? 0, item.cacheWrite1hTokens),
        cacheReadTokens: Math.max(prev?.cacheReadTokens ?? 0, item.cacheReadTokens)
      }
    }

    const dTotal = dIn + dOut + dCw5 + dCw1 + dCr
    if (dTotal <= 0) continue

    const bucket = (models[item.model] ??= createEmptyModelUsage())
    bucket.inputTokens += dIn
    bucket.outputTokens += dOut
    bucket.cacheWrite5mTokens += dCw5
    bucket.cacheWrite1hTokens += dCw1
    bucket.cacheReadTokens += dCr
    bucket.totalTokens += dTotal
  }

  for (const [model, bucket] of Object.entries(models)) {
    bucket.costUsd = computeUsageCostUsd(model, bucket, overrides)
  }

  return {
    models,
    nextMessageUsage: pruneWatermarkMap(nextWatermarks)
  }
}

/**
 * Parses a Claude Code session JSONL chunk into per-model token totals.
 * Deduplicates multi-block assistant messages by `message.id` (taking the latest block).
 */
export function parseClaudeJsonlContent(
  content: string,
  overrides?: CustomPricingOverrides,
  options?: ClaudeParseOptions
): Record<string, ModelTokenUsage> {
  return parseClaudeJsonlIncremental(content, overrides, options).models
}

function collectJsonlFiles(dir: string, out: string[], maxDepth: number): void {
  if (maxDepth < 0) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsonlFiles(full, out, maxDepth - 1)
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full)
    }
  }
}

function readNewLines(
  filePath: string,
  startOffset: number,
  fileSize: number,
  maxBytes: number
): { text: string; nextOffset: number } {
  const bytesToRead = Math.min(fileSize - startOffset, maxBytes)
  if (bytesToRead <= 0) return { text: '', nextOffset: startOffset }

  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.allocUnsafe(bytesToRead)
    const read = fs.readSync(fd, buf, 0, bytesToRead, startOffset)
    if (read <= 0) return { text: '', nextOffset: startOffset }

    // Align to the last newline so we don't parse a half-written JSONL line
    const slice = buf.subarray(0, read)
    const lastNewline = slice.lastIndexOf(0x0a)
    if (lastNewline === -1) {
      // No newline yet; wait for writer unless buffer is completely full
      if (read >= maxBytes) {
        return { text: slice.toString('utf8'), nextOffset: startOffset + read }
      }
      return { text: '', nextOffset: startOffset }
    }
    const consumed = lastNewline + 1
    return {
      text: slice.subarray(0, consumed).toString('utf8'),
      nextOffset: startOffset + consumed
    }
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Incrementally tails `~/.claude/projects` JSONL files by byte offset.
 * On baseline (`isBaseline: true` or empty `prevOffsets`), records file sizes with ZERO bytes read.
 * On subsequent polls, reads only newly appended bytes since the previous offset and deduplicates
 * streaming blocks across polls using `message.id` watermarks.
 */
export function scanClaudeLocalDeltas(
  prevOffsets: Record<string, number>,
  isBaseline: boolean,
  lastPollAt: number | null,
  overrides?: CustomPricingOverrides,
  options?: {
    projectsDir?: string
    maxReadBytesPerFile?: number
    prevMessageUsage?: Record<string, MessageUsageWatermark>
  }
): ClaudeDeltaScanResult {
  const projectsDir = options?.projectsDir ?? path.join(os.homedir(), '.claude', 'projects')
  const prevMessageUsage = options?.prevMessageUsage ?? {}

  if (!fs.existsSync(projectsDir)) {
    return {
      nextOffsets: {},
      nextMessageUsage: prevMessageUsage,
      deltaModels: {},
      deltaTokens: 0,
      deltaCostUsd: 0,
      hasLocalLogs: false
    }
  }

  const maxBytes = options?.maxReadBytesPerFile ?? 8 * 1024 * 1024 // 8 MiB safety cap per poll
  const files: string[] = []
  collectJsonlFiles(projectsDir, files, 3)

  // Guard against historical backfill when upgrading from a state with no recorded file offsets.
  const effectiveBaseline = isBaseline || Object.keys(prevOffsets).length === 0
  const nextOffsets: Record<string, number> = {}
  let currentMessageUsage: Record<string, MessageUsageWatermark> = { ...prevMessageUsage }
  let deltaModels: Record<string, ModelTokenUsage> = {}
  const newFileCutoff = (lastPollAt ?? Date.now()) - 60_000

  for (const filePath of files) {
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }

    const relKey = path.relative(projectsDir, filePath)
    const prevOffset = prevOffsets[relKey]

    if (effectiveBaseline) {
      nextOffsets[relKey] = stat.size
      continue
    }

    let readStart: number | null = null
    let filterSinceMs: number | null = null

    if (typeof prevOffset === 'number') {
      if (stat.size > prevOffset) {
        readStart = prevOffset
      } else {
        nextOffsets[relKey] = stat.size
        continue
      }
    } else {
      const birthMs =
        typeof stat.birthtimeMs === 'number' && stat.birthtimeMs > 0 ? stat.birthtimeMs : null
      const isTrulyNewFile =
        birthMs !== null ? birthMs >= newFileCutoff : stat.mtimeMs >= newFileCutoff

      if (isTrulyNewFile) {
        readStart = 0
        filterSinceMs = newFileCutoff
      } else {
        // Pre-existing/resumed session not yet in offsets: start from EOF to avoid historical backfill
        nextOffsets[relKey] = stat.size
        continue
      }
    }

    try {
      const { text, nextOffset } = readNewLines(filePath, readStart, stat.size, maxBytes)
      nextOffsets[relKey] = nextOffset
      if (text.length > 0) {
        const res = parseClaudeJsonlIncremental(text, overrides, {
          sinceMs: filterSinceMs,
          prevMessageUsage: currentMessageUsage
        })
        currentMessageUsage = res.nextMessageUsage
        deltaModels = mergeModelUsageMaps(deltaModels, res.models)
      }
    } catch {
      nextOffsets[relKey] = prevOffset ?? stat.size
    }
  }

  let deltaTokens = 0
  let deltaCostUsd = 0
  for (const u of Object.values(deltaModels)) {
    deltaTokens += u.totalTokens
    deltaCostUsd += u.costUsd
  }

  return {
    nextOffsets,
    nextMessageUsage: pruneWatermarkMap(currentMessageUsage),
    deltaModels,
    deltaTokens,
    deltaCostUsd,
    hasLocalLogs: files.length > 0
  }
}
