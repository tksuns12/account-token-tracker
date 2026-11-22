import type { DashboardView, PeriodGranularity } from './model'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Returns the latest stored dashboard snapshot without forcing a new CLI poll. */
    'tracker.get': { output: DashboardView }
    /** Polls Orca accounts & session history now, updates storage, and returns the view. */
    'tracker.refresh': { output: DashboardView }
    /** Clears stored windows, period rollups, and ledger history. */
    'tracker.reset': { output: DashboardView }
    /** Generates a CSV export of the raw percentage-jump ledger. */
    'tracker.exportCsv': { output: { filename: string; csv: string } }
    /** Generates a CSV export of weekly or monthly tokens-per-1% trends. */
    'tracker.exportTrendsCsv': {
      input: { granularity: PeriodGranularity }
      output: { filename: string; csv: string }
    }
  }
  interface PluginPanelEvents {
    /** Pushed to every open panel whenever a snapshot updates. */
    'tracker.updated': DashboardView
  }
}
