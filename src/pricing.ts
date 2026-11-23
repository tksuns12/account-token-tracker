export interface ModelPricePerMillion {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export interface ModelTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUsd: number
}

export type CustomPricingOverrides = Record<
  string,
  Partial<ModelPricePerMillion>
>

/**
 * Default API pricing in USD per 1M tokens.
 * Anthropic cache multipliers: 5m write = 1.25x input, 1h write = 2.0x input, read = 0.1x input.
 * Users can override any model via the `customPricingJson` plugin setting.
 */
const DEFAULT_RULES: Array<{ pattern: RegExp; price: ModelPricePerMillion }> = [
  // Anthropic Claude Opus 4.5 / 4.6 / 5.x ($5 in / $25 out)
  {
    pattern: /^claude-opus-(?:4-[5-9]|[5-9])/i,
    price: { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 }
  },
  // Anthropic Claude Opus 3 / 4 / 4.1 ($15 in / $75 out)
  {
    pattern: /opus/i,
    price: { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 }
  },
  // Anthropic Claude Sonnet ($3 in / $15 out)
  {
    pattern: /sonnet/i,
    price: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 }
  },
  // Anthropic Claude Haiku / Fable ($1 in / $5 out)
  {
    pattern: /haiku|fable/i,
    price: { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 }
  },
  // OpenAI / Codex
  {
    pattern: /^o3-mini|^o4-mini|gpt-5-mini|gpt-4o-mini/i,
    price: { input: 0.6, output: 2.4, cacheWrite5m: 0.6, cacheWrite1h: 0.6, cacheRead: 0.15 }
  },
  {
    pattern: /^gpt-5|^gpt-6|^o3|^codex/i,
    price: { input: 2.5, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 2.5, cacheRead: 0.25 }
  },
  {
    pattern: /^gpt-4o/i,
    price: { input: 2.5, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 2.5, cacheRead: 1.25 }
  },
  // Google Gemini
  {
    pattern: /gemini.*flash/i,
    price: { input: 0.15, output: 0.6, cacheWrite5m: 0.15, cacheWrite1h: 0.15, cacheRead: 0.0375 }
  },
  {
    pattern: /gemini.*(pro|argon|neon)/i,
    price: { input: 1.25, output: 10, cacheWrite5m: 1.25, cacheWrite1h: 1.25, cacheRead: 0.3125 }
  },
  // Other coding providers (approximate public API tiers)
  {
    pattern: /kimi/i,
    price: { input: 0.6, output: 2.5, cacheWrite5m: 0.6, cacheWrite1h: 0.6, cacheRead: 0.15 }
  },
  {
    pattern: /grok/i,
    price: { input: 3, output: 15, cacheWrite5m: 3, cacheWrite1h: 3, cacheRead: 0.75 }
  }
]

const FALLBACK_PRICE: ModelPricePerMillion = {
  input: 3,
  output: 15,
  cacheWrite5m: 3.75,
  cacheWrite1h: 6,
  cacheRead: 0.3
}

/** Provider-level blended USD per 1M total tokens when only aggregate token counts are available. */
const PROVIDER_FALLBACK_BLENDED_PER_MILLION: Record<string, number> = {
  claude: 2.0,
  codex: 2.5,
  gemini: 1.5,
  antigravity: 1.5,
  opencodeGo: 2.0,
  kimi: 1.0,
  grok: 3.0,
  cursor: 2.5,
  minimax: 0.8,
  zcode: 1.5,
  muse: 1.5
}

export function parseCustomPricing(jsonText: unknown): CustomPricingOverrides {
  if (typeof jsonText !== 'string' || jsonText.trim().length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(jsonText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as CustomPricingOverrides
  } catch {
    return {}
  }
}

export function getModelPrice(
  model: string,
  overrides?: CustomPricingOverrides
): ModelPricePerMillion {
  const base =
    DEFAULT_RULES.find((r) => r.pattern.test(model))?.price ?? FALLBACK_PRICE

  const custom = overrides?.[model]
  if (!custom) return base

  const input = typeof custom.input === 'number' && custom.input >= 0 ? custom.input : base.input
  const output =
    typeof custom.output === 'number' && custom.output >= 0 ? custom.output : base.output
  return {
    input,
    output,
    cacheWrite5m:
      typeof custom.cacheWrite5m === 'number' && custom.cacheWrite5m >= 0
        ? custom.cacheWrite5m
        : input * 1.25,
    cacheWrite1h:
      typeof custom.cacheWrite1h === 'number' && custom.cacheWrite1h >= 0
        ? custom.cacheWrite1h
        : input * 2.0,
    cacheRead:
      typeof custom.cacheRead === 'number' && custom.cacheRead >= 0
        ? custom.cacheRead
        : input * 0.1
  }
}

export function computeUsageCostUsd(
  model: string,
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheWrite5mTokens: number
    cacheWrite1hTokens: number
    cacheReadTokens: number
  },
  overrides?: CustomPricingOverrides
): number {
  if (!model || model === '<synthetic>') return 0
  const p = getModelPrice(model, overrides)
  const usd =
    (tokens.inputTokens * p.input +
      tokens.outputTokens * p.output +
      tokens.cacheWrite5mTokens * p.cacheWrite5m +
      tokens.cacheWrite1hTokens * p.cacheWrite1h +
      tokens.cacheReadTokens * p.cacheRead) /
    1_000_000
  return Number.isFinite(usd) && usd > 0 ? usd : 0
}

export function estimateBlendedCostUsd(provider: string, totalTokens: number): number {
  if (totalTokens <= 0) return 0
  const rate = PROVIDER_FALLBACK_BLENDED_PER_MILLION[provider] ?? 2.0
  return (totalTokens * rate) / 1_000_000
}

export function createEmptyModelUsage(): ModelTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costUsd: 0
  }
}

export function addModelUsage(a: ModelTokenUsage, b: ModelTokenUsage): ModelTokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd
  }
}

export function mergeModelUsageMaps(
  target: Record<string, ModelTokenUsage>,
  addition: Record<string, ModelTokenUsage>
): Record<string, ModelTokenUsage> {
  const out: Record<string, ModelTokenUsage> = { ...target }
  for (const [model, usage] of Object.entries(addition)) {
    if (usage.totalTokens <= 0 && usage.costUsd <= 0) continue
    out[model] = out[model] ? addModelUsage(out[model], usage) : { ...usage }
  }
  return out
}

export function shortenModelName(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
}

export function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '-'
  const abs = Math.abs(usd)
  if (abs === 0) return '$0.00'
  if (abs < 0.01) return `$${usd.toFixed(4)}`
  if (abs < 100) return `$${usd.toFixed(2)}`
  const sign = usd < 0 ? '-' : ''
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
}

export function formatUsdCompact(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '-'
  const abs = Math.abs(usd)
  const sign = usd < 0 ? '-' : ''
  if (abs === 0) return '$0'
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  if (abs >= 100) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
  if (abs >= 10) return `${sign}$${abs.toFixed(1)}`
  if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`
  return `${sign}$${abs.toFixed(4)}`
}
