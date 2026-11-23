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

export interface ClaudeDeltaScanResult {
  nextOffsets: Record<string, number>
  deltaModels: Record<string, ModelTokenUsage>
  deltaTokens: number
  deltaCostUsd: number
  hasLocalLogs: boolean
}

function asNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * Parses a Claude Code session JSONL chunk into per-model token totals.
 * Deduplicates multi-block assistant messages by `message.id` (taking the latest block).
 */
export function parseClaudeJsonlContent(
  content: string,
  overrides?: CustomPricingOverrides
): Record<string, ModelTokenUsage> {
  const byMessageId = new Map<
    string,
    {
      model: string
      inputTokens: number
      outputTokens: number
      cacheWrite5mTokens: number
      cacheWrite1hTokens: number
      cacheReadTokens: number
    }
  >()

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
    byMessageId.set(key, {
      model,
      inputTokens,
      outputTokens,
      cacheWrite5mTokens,
      cacheWrite1hTokens,
      cacheReadTokens
    })
  }

  const models: Record<string, ModelTokenUsage> = {}
  for (const item of byMessageId.values()) {
    const bucket = (models[item.model] ??= createEmptyModelUsage())
    bucket.inputTokens += item.inputTokens
    bucket.outputTokens += item.outputTokens
    bucket.cacheWrite5mTokens += item.cacheWrite5mTokens
    bucket.cacheWrite1hTokens += item.cacheWrite1hTokens
    bucket.cacheReadTokens += item.cacheReadTokens
    bucket.totalTokens +=
      item.inputTokens +
      item.outputTokens +
      item.cacheWrite5mTokens +
      item.cacheWrite1hTokens +
      item.cacheReadTokens
  }

  for (const [model, bucket] of Object.entries(models)) {
    bucket.costUsd = computeUsageCostUsd(model, bucket, overrides)
  }

  return models
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
 * On baseline (`isBaseline: true`), records file sizes with ZERO bytes read (<5ms even on multi-GB logs).
 * On subsequent polls, reads only newly appended bytes since the previous offset.
 */
export function scanClaudeLocalDeltas(
  prevOffsets: Record<string, number>,
  isBaseline: boolean,
  lastPollAt: number | null,
  overrides?: CustomPricingOverrides,
  options?: { projectsDir?: string; maxReadBytesPerFile?: number }
): ClaudeDeltaScanResult {
  const projectsDir = options?.projectsDir ?? path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(projectsDir)) {
    return {
      nextOffsets: {},
      deltaModels: {},
      deltaTokens: 0,
      deltaCostUsd: 0,
      hasLocalLogs: false
    }
  }

  const maxBytes = options?.maxReadBytesPerFile ?? 8 * 1024 * 1024 // 8 MiB safety cap per poll
  const files: string[] = []
  collectJsonlFiles(projectsDir, files, 3)

  const nextOffsets: Record<string, number> = {}
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

    if (isBaseline) {
      // Baseline: record current EOF without reading any historical bytes
      nextOffsets[relKey] = stat.size
      continue
    }

    let readStart: number | null = null
    if (typeof prevOffset === 'number') {
      if (stat.size > prevOffset) {
        readStart = prevOffset
      } else {
        nextOffsets[relKey] = stat.size
        continue
      }
    } else if (stat.mtimeMs >= newFileCutoff) {
      // Brand new session file created since last poll
      readStart = 0
    } else {
      // Pre-existing file not in offsets (e.g. upgraded from v2): start from EOF
      nextOffsets[relKey] = stat.size
      continue
    }

    try {
      const { text, nextOffset } = readNewLines(filePath, readStart, stat.size, maxBytes)
      nextOffsets[relKey] = nextOffset
      if (text.length > 0) {
        const parsed = parseClaudeJsonlContent(text, overrides)
        deltaModels = mergeModelUsageMaps(deltaModels, parsed)
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
    deltaModels,
    deltaTokens,
    deltaCostUsd,
    hasLocalLogs: files.length > 0
  }
}
