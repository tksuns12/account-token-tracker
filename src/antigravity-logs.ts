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

export interface AntigravityDeltaScanResult {
  nextOffsets: Record<string, number>
  nextSeenSteps: string[]
  deltaModels: Record<string, ModelTokenUsage>
  deltaTokens: number
  deltaCostUsd: number
  hasLocalLogs: boolean
}

const MAX_SEEN_STEPS = 250

function asNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

function parseTimestampMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.length > 0) {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function pruneSeenSteps(list: string[]): string[] {
  if (list.length <= MAX_SEEN_STEPS) return list
  return list.slice(list.length - MAX_SEEN_STEPS)
}

export interface AntigravityParseOptions {
  sinceMs?: number | null
  fileKey?: string
  seenSteps?: Set<string>
}

/**
 * Parses an Antigravity CLI `transcript.jsonl` chunk into per-model token totals and USD cost.
 * Deduplicates by `step_index` both within a chunk and across polls when `seenSteps` is provided.
 */
export function parseAntigravityTranscriptContent(
  content: string,
  overrides?: CustomPricingOverrides,
  options?: AntigravityParseOptions
): Record<string, ModelTokenUsage> {
  const sinceMs =
    typeof options?.sinceMs === 'number' && Number.isFinite(options.sinceMs)
      ? options.sinceMs
      : null
  const seenSteps = options?.seenSteps
  const filePrefix = options?.fileKey ? `${options.fileKey}#` : ''

  const byStep = new Map<
    string,
    {
      model: string
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
    }
  >()

  let anonSeq = 0
  const lines = content.split('\n')
  for (const line of lines) {
    if (!line.includes('"input_tokens"') && !line.includes('"output_tokens"')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const rec = parsed as {
      timestamp?: unknown
      step_index?: unknown
      model?: unknown
      input_tokens?: unknown
      output_tokens?: unknown
      cache_read_tokens?: unknown
    }

    if (sinceMs !== null) {
      const recMs = parseTimestampMs(rec.timestamp)
      if (recMs !== null && recMs < sinceMs) continue
    }

    const model = typeof rec.model === 'string' ? rec.model.trim() : ''
    if (!model) continue

    const inputTokens = asNonNegInt(rec.input_tokens)
    const outputTokens = asNonNegInt(rec.output_tokens)
    const cacheReadTokens = asNonNegInt(rec.cache_read_tokens)
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0) continue

    const hasStep = typeof rec.step_index === 'number' && Number.isFinite(rec.step_index)
    const key = hasStep ? `${filePrefix}step-${rec.step_index}` : `anon-${++anonSeq}`
    if (hasStep && seenSteps?.has(key)) continue

    byStep.set(key, { model, inputTokens, outputTokens, cacheReadTokens })
  }

  const models: Record<string, ModelTokenUsage> = {}
  for (const [key, item] of byStep.entries()) {
    if (!key.startsWith('anon-') && seenSteps) {
      seenSteps.add(key)
    }
    const bucket = (models[item.model] ??= createEmptyModelUsage())
    bucket.inputTokens += item.inputTokens
    bucket.outputTokens += item.outputTokens
    bucket.cacheReadTokens += item.cacheReadTokens
    bucket.totalTokens += item.inputTokens + item.outputTokens + item.cacheReadTokens
  }

  for (const [model, bucket] of Object.entries(models)) {
    bucket.costUsd = computeUsageCostUsd(model, bucket, overrides)
  }

  return models
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

    const slice = buf.subarray(0, read)
    const lastNewline = slice.lastIndexOf(0x0a)
    if (lastNewline === -1) {
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

function collectTranscriptFiles(brainDirs: string[]): Array<{ key: string; filePath: string }> {
  const out: Array<{ key: string; filePath: string }> = []
  for (const brainDir of brainDirs) {
    if (!fs.existsSync(brainDir)) continue
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(brainDir, { withFileTypes: true })
    } catch {
      continue
    }
    const baseTag = path.basename(path.dirname(brainDir))
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const transcriptPath = path.join(
        brainDir,
        entry.name,
        '.system_generated',
        'logs',
        'transcript.jsonl'
      )
      if (fs.existsSync(transcriptPath)) {
        out.push({ key: `${baseTag}/${entry.name}`, filePath: transcriptPath })
      }
    }
  }
  return out
}

/**
 * Incrementally tails Antigravity CLI `transcript.jsonl` files under
 * `~/.gemini/antigravity-cli/brain/<conv-id>/.system_generated/logs/transcript.jsonl`
 * by byte offset, guarding against uninitialized-offset historical backfills.
 */
export function scanAntigravityLocalDeltas(
  prevOffsets: Record<string, number>,
  isBaseline: boolean,
  lastPollAt: number | null,
  overrides?: CustomPricingOverrides,
  options?: {
    brainDirs?: string[]
    maxReadBytesPerFile?: number
    prevSeenSteps?: string[]
  }
): AntigravityDeltaScanResult {
  const brainDirs = options?.brainDirs ?? [
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain'),
    path.join(os.homedir(), '.gemini', 'antigravity', 'brain')
  ]
  const seenSteps = new Set<string>(options?.prevSeenSteps ?? [])

  const files = collectTranscriptFiles(brainDirs)
  if (files.length === 0) {
    return {
      nextOffsets: {},
      nextSeenSteps: pruneSeenSteps(Array.from(seenSteps)),
      deltaModels: {},
      deltaTokens: 0,
      deltaCostUsd: 0,
      hasLocalLogs: false
    }
  }

  const maxBytes = options?.maxReadBytesPerFile ?? 8 * 1024 * 1024
  const effectiveBaseline = isBaseline || Object.keys(prevOffsets).length === 0
  const nextOffsets: Record<string, number> = {}
  let deltaModels: Record<string, ModelTokenUsage> = {}
  const newFileCutoff = (lastPollAt ?? Date.now()) - 60_000

  for (const { key, filePath } of files) {
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }

    const prevOffset = prevOffsets[key]
    if (effectiveBaseline) {
      nextOffsets[key] = stat.size
      continue
    }

    let readStart: number | null = null
    let filterSinceMs: number | null = null

    if (typeof prevOffset === 'number') {
      if (stat.size > prevOffset) {
        readStart = prevOffset
      } else {
        nextOffsets[key] = stat.size
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
        nextOffsets[key] = stat.size
        continue
      }
    }

    try {
      const { text, nextOffset } = readNewLines(filePath, readStart, stat.size, maxBytes)
      nextOffsets[key] = nextOffset
      if (text.length > 0) {
        const parsed = parseAntigravityTranscriptContent(text, overrides, {
          sinceMs: filterSinceMs,
          fileKey: key,
          seenSteps
        })
        deltaModels = mergeModelUsageMaps(deltaModels, parsed)
      }
    } catch {
      nextOffsets[key] = prevOffset ?? stat.size
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
    nextSeenSteps: pruneSeenSteps(Array.from(seenSteps)),
    deltaModels,
    deltaTokens,
    deltaCostUsd,
    hasLocalLogs: true
  }
}
