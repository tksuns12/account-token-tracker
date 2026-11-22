# Account Token Tracker

An [Orca](https://onorca.dev) plugin that tracks **per-account quota percentage (`%`) vs actual token consumption (`Δtokens`)**, and monitors **weekly & monthly `tokens per 1%` trends** to detect silent quota nerfs (enshittification).

계정별 쿼터 사용률(`%`) 변화와 실제 에이전트 토큰 사용량(`Δtokens`)을 매칭하고, **주간/월간 1%당 토큰량 추이**를 영구 기록하여 토큰 효율 저하(enshittification)를 감시하는 Orca 플러그인입니다.

## Features

- **Per-Account & Per-Window Tracking**: Polls `orca account list --json` for active/inactive accounts across supported providers (Claude, Codex, Antigravity, Gemini, OpenCode Go, Kimi, Cursor, etc.) and their 5-hour / weekly / bucket windows.
- **Exact `Δ%` ↔ `Δtokens` Matching**: Reads local agent session token deltas via Orca's `agent.listSessions` (`history:read`). Buffers sub-1% token spend (`pendingTokens`) and flushes it into the ledger when the integer `%` ticks up, avoiding rounding loss.
- **Weekly & Monthly Enshittification Watch**:
  - Permanently aggregates ISO-week (`YYYY-Www`) and monthly (`YYYY-MM`) `tokens / 1%` rollups.
  - Compares each period against both the previous period (WoW / MoM) and your initial baseline period.
  - Flags a warning banner and status-bar indicator when `tokens / 1%` drops below your configured threshold (default: `-15%`).
- **Status Bar & CSV Export**: Live status bar summary (`Claude 21% · 120.0K/1%`) and one-click CSV export for both raw `%` jumps and weekly/monthly trend tables.

## Installation

### Via Orca CLI

```bash
orca plugin install tksuns12/account-token-tracker --json
```

*(Because this plugin runs a `trusted-worker` to poll account quotas and read session token counts, Orca will print an approval prompt on first install. Review the requested capabilities and re-run with the `--approve <fingerprint>` flag Orca prints.)*

### Via Orca Community Directory

Once indexed, install directly from **Settings → Plugins** or view the listing at:
`https://www.onorca.dev/plugins/tksuns12/account-token-tracker`

## Requested Capabilities

| Capability | Why it is needed |
| --- | --- |
| `storage:own` | Persists quota baselines, `%` jump ledger, and permanent weekly/monthly rollups locally. |
| `settings:own` | Reads user settings (`pollIntervalSec`, `maxLedgerEntries`, `nerfAlertDropPercent`). |
| `history:read` | Calls `agent.listSessions` to read per-session token totals (never conversation content). |
| `agent:read` | Subscribes to `agent.status.changed` to trigger a snapshot when an agent finishes a turn. |

## Settings

Configure in **Settings → Plugins → Account Token Tracker**:

- **Polling interval (seconds)** (`pollIntervalSec`, default `60`): Background snapshot cadence.
- **Maximum raw ledger entries** (`maxLedgerEntries`, default `300`): Cap on individual `%` jump records (weekly/monthly rollups are kept permanently).
- **Enshittification alert threshold (% drop)** (`nerfAlertDropPercent`, default `15`): Percentage drop vs baseline `tokens / 1%` that triggers a degradation warning.

## Development

```bash
orca plugin validate . --json
orca plugin test . --json
orca plugin check . --json
orca plugin dev load . --json
```

## License

MIT
