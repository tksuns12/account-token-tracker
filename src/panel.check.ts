import { defineCheck } from 'orca/testing'
import type { TrackerState } from './model'

const populatedState: TrackerState = {
  version: 3,
  lastPollAt: 1795156500000,
  lastError: null,
  windows: {
    'claude::claude:system::weekly': {
      key: 'claude::claude:system::weekly',
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      planType: 'max_20x',
      isActiveAccount: true,
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      windowMinutes: 10080,
      resetsAt: 1795694400308,
      resetDescription: 'Thu 9:00 PM',
      baselinePercent: 18,
      currentPercent: 21,
      trackedDeltaPercent: 3,
      trackedTokens: 360_000,
      pendingTokens: 0,
      trackedCostUsd: 4.5,
      pendingCostUsd: 0,
      trackedModels: {
        'claude-opus-5-5': {
          inputTokens: 10_000,
          outputTokens: 60_000,
          cacheWrite5mTokens: 50_000,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 100_000,
          totalTokens: 220_000,
          costUsd: 3.2
        },
        'claude-sonnet-5-5': {
          inputTokens: 5_000,
          outputTokens: 30_000,
          cacheWrite5mTokens: 25_000,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 80_000,
          totalTokens: 140_000,
          costUsd: 1.3
        }
      },
      pendingModels: {},
      firstSeenAt: 1795150000000,
      lastUpdatedAt: 1795156500000
    }
  },
  ledger: [
    {
      id: '1795156500000-claude::claude:system::weekly',
      timestamp: 1795156500000,
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      fromPercent: 18,
      toPercent: 21,
      deltaPercent: 3,
      deltaTokens: 360_000,
      tokensPerPercent: 120_000,
      deltaCostUsd: 4.5,
      usdPerPercent: 1.5,
      models: {
        'claude-opus-5-5': {
          inputTokens: 10_000,
          outputTokens: 60_000,
          cacheWrite5mTokens: 50_000,
          cacheWrite1hTokens: 0,
          cacheReadTokens: 100_000,
          totalTokens: 220_000,
          costUsd: 3.2
        }
      },
      sessionTitles: ['Refactor auth middleware']
    }
  ],
  periodStats: {
    'week::2026-W46::claude::claude:system::weekly': {
      key: 'week::2026-W46::claude::claude:system::weekly',
      periodType: 'week',
      periodKey: '2026-W46',
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      totalDeltaPercent: 10,
      totalDeltaTokens: 1_500_000,
      totalDeltaCostUsd: 20.0,
      models: {},
      sampleCount: 5,
      firstTimestamp: 1794500000000,
      lastTimestamp: 1794700000000
    },
    'week::2026-W47::claude::claude:system::weekly': {
      key: 'week::2026-W47::claude::claude:system::weekly',
      periodType: 'week',
      periodKey: '2026-W47',
      provider: 'claude',
      accountId: 'claude:system',
      accountLabel: 'Claude (max_20x)',
      windowId: 'weekly',
      windowLabel: 'Weekly (7d)',
      totalDeltaPercent: 8,
      totalDeltaTokens: 960_000,
      totalDeltaCostUsd: 12.0,
      models: {},
      sampleCount: 4,
      firstTimestamp: 1795100000000,
      lastTimestamp: 1795156500000
    }
  },
  sessionTokens: {},
  claudeFileOffsets: {},
  antigravityFileOffsets: {}
}

export default defineCheck({
  empty: {},
  populated: {
    storage: {
      trackerState: populatedState as unknown as Record<string, never>
    }
  }
})
