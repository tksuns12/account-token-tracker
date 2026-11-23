# Account Token Tracker

An [Orca](https://onorca.dev) plugin that tracks **per-account quota percentage (`%`) vs per-model API dollar value (`$/1%`)**, and monitors **weekly & monthly `$/1%` trends** to detect silent quota nerfs (enshittification).

계정별 쿼터 사용률(`%`) 변화와 **모델별 사용량 및 API 달러 환산 가치(`$/1%`)**를 추적하고, **주간/월간 `$/1%` 추이**를 영구 기록하여 구독 쿼터의 실질 가치 저하(enshittification)를 감시하는 Orca 플러그인입니다.

## Why `$/1%` instead of raw tokens?

A raw token count fluctuates wildly depending on whether you used Opus vs Sonnet vs Haiku, or cache reads vs output tokens. By weighting each model's `input`, `output`, `cache_write (5m / 1h)`, and `cache_read` tokens at public API rates, **Account Token Tracker** normalizes usage into **API dollar value per 1% of quota (`$/1%`)** and **estimated 100% quota value (`$`)** — making silent quota shrinkage immediately visible.

## Features

- **Per-Model Breakdown & Exact USD Valuation**:
  - Reads local Claude Code session logs (`~/.claude/projects/*/*.jsonl`, deduplicated by `message.id` with mtime caching) for exact per-model `input`, `output`, `cache_write (5m/1h)`, and `cache_read` token pricing.
  - Falls back to Orca's `agent.listSessions` (`history:read`) with provider blended rates for other agents.
  - Supports custom per-model pricing overrides via the `customPricingJson` setting.
- **Per-Account & Per-Window Tracking**: Polls `orca account list --json` for active/inactive accounts and their 5-hour / weekly / bucket windows. Sub-1% spend is buffered until `%` ticks up.
- **Weekly & Monthly Enshittification Watch**:
  - Permanently aggregates ISO-week (`YYYY-Www`) and monthly (`YYYY-MM`) `$/1%` rollups.
  - Compares each period against both the previous period (WoW / MoM) and your initial baseline period.
  - Raises a warning banner and status-bar alert (`⚠`) when `$/1%` drops below your configured threshold (default: `-15%`).
- **Status Bar & CSV Export**: Live status bar summary (`Claude 21% · $1.50/1%`) and one-click CSV export for both raw `%` jumps and weekly/monthly trends.

## Installation

```bash
orca plugin install tksuns12/account-token-tracker --json
```

Or view the community directory listing at:
`https://www.onorca.dev/plugins/tksuns12/account-token-tracker`

## Requested Capabilities

| Capability | Why it is needed |
| --- | --- |
| `storage:own` | Persists quota baselines, `%` jump ledger, and permanent weekly/monthly rollups locally. |
| `settings:own` | Reads user settings (`pollIntervalSec`, `maxLedgerEntries`, `nerfAlertDropPercent`, `customPricingJson`). |
| `history:read` | Calls `agent.listSessions` for agents without local JSONL breakdown (never conversation content). |
| `agent:read` | Subscribes to `agent.status.changed` to trigger a snapshot when an agent finishes a turn. |

## Development

```bash
orca plugin validate . --json
orca plugin test . --json
orca plugin check . --json
orca plugin dev load . --json
```

## License

MIT
