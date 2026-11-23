(function () {
  const rootEl = document.getElementById('app')
  const renderApi = window.TrackerRender

  const STORAGE_KEY = 'account-token-tracker-ui-v4'

  function loadPersistedPrefs() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function savePersistedPrefs(prefs) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      // Ignore storage failures in sandboxed frames
    }
  }

  const saved = loadPersistedPrefs()
  let dashboardView = null

  const uiState = {
    activeTab:
      saved.activeTab === 'trends' || saved.activeTab === 'ledger' ? saved.activeTab : 'overview',
    granularity: saved.granularity === 'month' ? 'month' : 'week',
    providerFilter: typeof saved.providerFilter === 'string' ? saved.providerFilter : 'all',
    showAllLedger: Boolean(saved.showAllLedger),
    ledgerLimit: 40,
    refreshing: false,
    confirmReset: false,
    notice: null,
    expandedIdleAccounts: {},
    expandedLedgerIds: {},
    selectedChartPoint: {}
  }

  function persist() {
    savePersistedPrefs({
      activeTab: uiState.activeTab,
      granularity: uiState.granularity,
      providerFilter: uiState.providerFilter,
      showAllLedger: uiState.showAllLedger
    })
  }

  function paint() {
    if (!rootEl || !renderApi) return
    rootEl.innerHTML = renderApi.renderApp(dashboardView, uiState, Date.now())
  }

  async function loadInitial() {
    try {
      dashboardView = await window.orca.plugin.request('tracker.get')
    } catch (err) {
      uiState.notice = err instanceof Error ? err.message : String(err)
    }
    paint()
  }

  async function refreshNow() {
    if (uiState.refreshing) return
    uiState.refreshing = true
    uiState.notice = null
    paint()
    try {
      dashboardView = await window.orca.plugin.request('tracker.refresh')
    } catch (err) {
      uiState.notice = err instanceof Error ? err.message : String(err)
    } finally {
      uiState.refreshing = false
      paint()
    }
  }

  async function exportCsv() {
    try {
      const result =
        uiState.activeTab === 'trends'
          ? await window.orca.plugin.request('tracker.exportTrendsCsv', {
              granularity: uiState.granularity
            })
          : await window.orca.plugin.request('tracker.exportCsv')

      if (!window.orca.files || typeof window.orca.files.saveAs !== 'function') {
        uiState.notice = '현재 환경에서는 파일 저장을 지원하지 않습니다.'
        paint()
        return
      }
      const res = await window.orca.files.saveAs({
        suggestedName: result.filename,
        mimeType: 'text/csv;charset=utf-8',
        data: result.csv
      })
      if (res && res.status === 'saved') {
        uiState.notice = `${result.filename} 저장 완료`
        paint()
      }
    } catch (err) {
      uiState.notice = err instanceof Error ? err.message : String(err)
      paint()
    }
  }

  async function confirmReset() {
    uiState.confirmReset = false
    paint()
    try {
      dashboardView = await window.orca.plugin.request('tracker.reset')
      uiState.notice = '추적 기록 및 주간/월간 추이를 초기화했습니다.'
    } catch (err) {
      uiState.notice = err instanceof Error ? err.message : String(err)
    }
    paint()
  }

  if (rootEl) {
    rootEl.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return

      const tabBtn = target.closest('[data-tab]')
      if (tabBtn) {
        const nextTab = tabBtn.getAttribute('data-tab')
        if (nextTab === 'overview' || nextTab === 'trends' || nextTab === 'ledger') {
          uiState.activeTab = nextTab
          persist()
          paint()
        }
        return
      }

      const providerBtn = target.closest('[data-provider]')
      if (providerBtn) {
        uiState.providerFilter = providerBtn.getAttribute('data-provider') || 'all'
        persist()
        paint()
        return
      }

      const granBtn = target.closest('[data-granularity]')
      if (granBtn) {
        uiState.granularity = granBtn.getAttribute('data-granularity') === 'month' ? 'month' : 'week'
        persist()
        paint()
        return
      }

      const ledgerFilterBtn = target.closest('[data-ledger-filter]')
      if (ledgerFilterBtn) {
        uiState.showAllLedger = ledgerFilterBtn.getAttribute('data-ledger-filter') === 'all'
        uiState.ledgerLimit = 40
        persist()
        paint()
        return
      }

      const idleToggle = target.closest('[data-toggle-idle]')
      if (idleToggle) {
        const key = idleToggle.getAttribute('data-toggle-idle')
        if (key) {
          uiState.expandedIdleAccounts[key] = !uiState.expandedIdleAccounts[key]
          paint()
        }
        return
      }

      const ledgerToggle = target.closest('[data-toggle-ledger]')
      if (ledgerToggle) {
        const id = ledgerToggle.getAttribute('data-toggle-ledger')
        if (id) {
          uiState.expandedLedgerIds[id] = !uiState.expandedLedgerIds[id]
          paint()
        }
        return
      }

      const chartPoint = target.closest('[data-chart-series]')
      if (chartPoint) {
        const seriesKey = chartPoint.getAttribute('data-chart-series')
        const idx = Number(chartPoint.getAttribute('data-chart-idx'))
        if (seriesKey && Number.isFinite(idx)) {
          uiState.selectedChartPoint[seriesKey] = idx
          paint()
        }
        return
      }

      const actionEl = target.closest('[data-action]')
      if (actionEl) {
        const action = actionEl.getAttribute('data-action')
        if (action === 'refresh') void refreshNow()
        else if (action === 'export') void exportCsv()
        else if (action === 'toggle-reset') {
          uiState.confirmReset = !uiState.confirmReset
          paint()
        } else if (action === 'cancel-reset') {
          uiState.confirmReset = false
          paint()
        } else if (action === 'confirm-reset') {
          void confirmReset()
        } else if (action === 'dismiss-notice') {
          uiState.notice = null
          paint()
        } else if (action === 'load-more') {
          uiState.ledgerLimit += 40
          paint()
        }
      }
    })
  }

  if (window.orca) {
    window.orca.plugin.on('tracker.updated', (payload) => {
      dashboardView = payload
      paint()
    })
    if (typeof window.orca.on === 'function') {
      window.orca.on('theme', () => {
        paint()
      })
    }
    void loadInitial()
  }

  // Keep relative timestamps fresh without re-polling the worker
  window.setInterval(() => {
    if (dashboardView && !document.hidden) paint()
  }, 30_000)
})()
