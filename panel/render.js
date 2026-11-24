(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
  root.TrackerRender = api
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function formatUsd(usd) {
    if (typeof usd !== 'number' || !Number.isFinite(usd)) return '-'
    const abs = Math.abs(usd)
    if (abs === 0) return '$0.00'
    if (abs < 0.01) return `$${usd.toFixed(4)}`
    if (abs < 100) return `$${usd.toFixed(2)}`
    const sign = usd < 0 ? '-' : ''
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
  }

  function formatUsdCompact(usd) {
    if (typeof usd !== 'number' || !Number.isFinite(usd)) return '-'
    const abs = Math.abs(usd)
    const sign = usd < 0 ? '-' : ''
    if (abs === 0) return '$0'
    if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
    if (abs >= 100) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
    if (abs >= 10) return `${sign}$${abs.toFixed(1)}`
    if (abs >= 0.01) return `${sign}$${abs.toFixed(2)}`
    return `${sign}$${abs.toFixed(4)}`
  }

  function formatTokens(tokens) {
    if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return '-'
    const abs = Math.abs(tokens)
    if (abs >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(2)}B`
    if (abs >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
    if (abs >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
    return `${Math.round(tokens)}`
  }

  function formatSignedPercent(pct) {
    if (typeof pct !== 'number' || !Number.isFinite(pct)) return '-'
    const rounded = Math.round(pct * 10) / 10
    if (rounded > 0) return `+${rounded.toFixed(1)}%`
    return `${rounded.toFixed(1)}%`
  }

  function formatRelativeTime(timestampMs, nowMs) {
    if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs)) return '미수집'
    const now = typeof nowMs === 'number' ? nowMs : Date.now()
    const diffSec = Math.max(0, Math.round((now - timestampMs) / 1000))
    if (diffSec < 10) return '방금'
    if (diffSec < 60) return `${diffSec}초 전`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}분 전`
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return `${diffHour}시간 전`
    const diffDay = Math.floor(diffHour / 24)
    return `${diffDay}일 전`
  }

  function providerColor(provider) {
    switch (provider) {
      case 'claude':
        return '#d97757'
      case 'antigravity':
        return '#34d399'
      case 'codex':
        return '#fbbf24'
      case 'gemini':
        return '#38bdf8'
      case 'cursor':
        return '#a78bfa'
      default:
        return '#94a3b8'
    }
  }

  function providerName(provider) {
    switch (provider) {
      case 'claude':
        return 'Claude'
      case 'codex':
        return 'Codex'
      case 'antigravity':
        return 'Antigravity'
      case 'gemini':
        return 'Gemini'
      case 'opencodeGo':
        return 'OpenCode Go'
      case 'kimi':
        return 'Kimi'
      case 'cursor':
        return 'Cursor'
      case 'grok':
        return 'Grok'
      case 'minimax':
        return 'MiniMax'
      case 'zcode':
        return 'ZCode'
      case 'muse':
        return 'Muse'
      default:
        return provider
    }
  }

  function modelColor(modelName) {
    const m = String(modelName || '').toLowerCase()
    if (m.includes('opus')) return 'var(--model-opus)'
    if (m.includes('sonnet')) return 'var(--model-sonnet)'
    if (m.includes('haiku') || m.includes('fable')) return 'var(--model-haiku)'
    if (m.includes('gemini') || m.includes('neon') || m.includes('argon')) return 'var(--model-gemini)'
    if (m.includes('gpt') || m.includes('codex') || /\bo[134]\b/.test(m)) return 'var(--model-gpt)'
    return 'var(--model-other)'
  }

  function shortenWindowLabel(label) {
    return String(label || '')
      .replace(/Claude and GPT models/i, 'Claude/GPT')
      .replace(/Gemini Models/i, 'Gemini')
      .replace(/Five Hour/i, '5h')
      .replace(/Weekly \(7d\)/i, 'Weekly')
      .replace(/Fable Weekly \(7d\)/i, 'Fable Weekly')
  }

  function percentTone(pct) {
    if (pct >= 90) return 'danger'
    if (pct >= 75) return 'warning'
    if (pct > 0) return 'accent'
    return 'neutral'
  }

  function driftMeta(status) {
    switch (status) {
      case 'degraded':
        return { label: '가치 하락 의심', tone: 'danger' }
      case 'watch':
        return { label: '하락 주의', tone: 'warning' }
      case 'stable':
        return { label: '안정', tone: 'success' }
      default:
        return { label: '기준 수집 중', tone: 'neutral' }
    }
  }

  function shortPeriodTick(periodKey) {
    if (/^\d{4}-W\d{2}$/.test(periodKey)) return periodKey.slice(5)
    if (/^\d{4}-\d{2}$/.test(periodKey)) return periodKey.slice(2)
    return periodKey
  }

  function renderTrendChartSvg(series, selectedIndex, nerfDropPercent) {
    const points = Array.isArray(series.points) ? series.points : []
    if (points.length < 2) {
      const p = points[0]
      const valText =
        series.metricKind === 'usd'
          ? `약 ${formatUsd(series.latestMonthlyUsd)}/월`
          : `${formatTokens(series.latestTokensPerPercent)} tok/1%`
      return `
        <div class="baseline-box">
          <div>첫 기준점 확보: <strong class="num">${escapeHtml(valText)}</strong> (${escapeHtml(series.latestPeriodKey)} · Δ${escapeHtml(series.latestDeltaPercent)}%)</div>
          <div>다음 ${series.periodType === 'week' ? '주' : '월'} 데이터가 누적되면 기준선 대비 추이 그래프가 표시됩니다.</div>
          ${p && p.topModelsSummary && p.topModelsSummary !== '-' ? `<div>주요 모델: ${escapeHtml(p.topModelsSummary)}</div>` : ''}
        </div>
      `
    }

    const W = 272
    const H = 96
    const padL = 6
    const padR = 6
    const padT = 12
    const padB = 20
    const plotW = W - padL - padR
    const plotH = H - padT - padB

    const useUsd = series.metricKind === 'usd'
    const values = points.map((p) => (useUsd ? p.monthlyUsd : p.tokensPerPercent))
    const baseVal = values[0] || 0
    const thresholdVal = baseVal * (1 - (nerfDropPercent || 15) / 100)
    const maxVal = Math.max(...values, baseVal, 1) * 1.12

    const toY = (v) => padT + plotH - (Math.max(0, v) / maxVal) * plotH
    const slotW = plotW / points.length
    const barW = Math.min(24, Math.max(8, slotW * 0.44))

    const coords = points.map((p, i) => ({
      x: padL + slotW * i + slotW / 2,
      y: toY(values[i]),
      val: values[i],
      p
    }))

    const baseY = toY(baseVal)
    const warnY = toY(thresholdVal)
    const activeIdx =
      typeof selectedIndex === 'number' && selectedIndex >= 0 && selectedIndex < points.length
        ? selectedIndex
        : points.length - 1

    const linePath = coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ')

    const barsSvg = coords
      .map((c, i) => {
        const barH = Math.max(2, padT + plotH - c.y)
        const isSelected = i === activeIdx
        const dropPct = c.p.vsBaselinePercent
        const fill =
          dropPct !== null && dropPct <= -(nerfDropPercent || 15)
            ? 'var(--danger)'
            : dropPct !== null && dropPct <= -(nerfDropPercent || 15) / 2
              ? 'var(--warning)'
              : 'var(--accent)'
        return `<rect x="${(c.x - barW / 2).toFixed(1)}" y="${c.y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="${fill}" opacity="${isSelected ? '0.42' : '0.18'}" />`
      })
      .join('')

    const dotsSvg = coords
      .map((c, i) => {
        const isSelected = i === activeIdx
        const dropPct = c.p.vsBaselinePercent
        const fill =
          dropPct !== null && dropPct <= -(nerfDropPercent || 15)
            ? 'var(--danger)'
            : dropPct !== null && dropPct <= -(nerfDropPercent || 15) / 2
              ? 'var(--warning)'
              : 'var(--accent)'
        return `
          <g class="chart-point-hit" data-chart-series="${escapeHtml(series.seriesKey)}" data-chart-idx="${i}">
            <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="10" fill="transparent" />
            <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${isSelected ? '4' : '2.8'}" fill="${fill}" stroke="var(--bg)" stroke-width="1.5" />
          </g>
        `
      })
      .join('')

    const labelStep = points.length > 6 ? Math.ceil(points.length / 5) : 1
    const labelsSvg = coords
      .map((c, i) => {
        if (i !== 0 && i !== points.length - 1 && i % labelStep !== 0) return ''
        return `<text x="${c.x.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="9" fill="var(--fg-muted)" font-family="var(--font-mono)">${escapeHtml(shortPeriodTick(c.p.periodKey))}</text>`
      })
      .join('')

    const activePoint = points[activeIdx]
    const activeValText = useUsd
      ? `${formatUsd(activePoint.monthlyUsd)}/월 (${formatUsd(activePoint.usdPerPercent)}/1%)`
      : `${formatTokens(activePoint.tokensPerPercent)} tok/1%`

    return `
      <div class="chart-box">
        <svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(series.accountLabel)} 추이 차트">
          <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="var(--border)" stroke-width="1" />
          <line x1="${padL}" y1="${baseY.toFixed(1)}" x2="${W - padR}" y2="${baseY.toFixed(1)}" stroke="var(--fg-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.55" />
          <line x1="${padL}" y1="${warnY.toFixed(1)}" x2="${W - padR}" y2="${warnY.toFixed(1)}" stroke="var(--danger)" stroke-width="1" stroke-dasharray="2 3" opacity="0.45" />
          ${barsSvg}
          <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" />
          ${dotsSvg}
          ${labelsSvg}
        </svg>
        <div class="chart-caption num">
          <span>${escapeHtml(activePoint.periodKey)} · Δ+${escapeHtml(activePoint.deltaPercent)}%</span>
          <span>${escapeHtml(activeValText)}</span>
        </div>
      </div>
    `
  }

  function renderModelMix(breakdown) {
    if (!Array.isArray(breakdown) || breakdown.length === 0) return ''
    const top = breakdown.slice(0, 4)
    const segments = top
      .map((m) => {
        const pct = Math.max(2, m.sharePercent)
        const title = `${m.shortName}: ${formatUsd(m.costUsd)} (${Math.round(m.sharePercent)}%) · In ${formatTokens(m.inputTokens)} / Out ${formatTokens(m.outputTokens)} / CacheR ${formatTokens(m.cacheReadTokens)}`
        return `<div class="stacked-seg" style="width:${pct.toFixed(1)}%;background:${modelColor(m.model)}" title="${escapeHtml(title)}"></div>`
      })
      .join('')

    const legend = top
      .map((m) => {
        const title = `In ${formatTokens(m.inputTokens)} · Out ${formatTokens(m.outputTokens)} · CacheR ${formatTokens(m.cacheReadTokens)} · CacheW ${formatTokens(m.cacheWriteTokens)}`
        return `
          <div class="model-row" title="${escapeHtml(title)}">
            <span class="model-name">
              <span class="model-dot" style="background:${modelColor(m.model)}"></span>
              <span>${escapeHtml(m.shortName)}</span>
            </span>
            <span class="model-share num">${Math.round(m.sharePercent)}%</span>
            <span class="model-cost num">${escapeHtml(formatUsd(m.costUsd))}</span>
          </div>
        `
      })
      .join('')

    return `
      <div class="model-section">
        <div class="stacked-bar" aria-label="모델별 비용 비중">${segments}</div>
        <div class="model-legend">${legend}</div>
      </div>
    `
  }

  function renderWindowRow(w) {
    const tone = percentTone(w.currentPercent)
    const pct = Math.max(0, Math.min(100, Math.round(w.currentPercent)))
    const resetLabel = w.resetCountdownText || w.resetDescription || ''
    const hasActivity = w.trackedDeltaPercent > 0 || w.trackedCostUsd > 0 || w.trackedTokens > 0
    const spendText =
      w.trackedCostUsd > 0
        ? `${formatUsd(w.trackedCostUsd)} · ${formatTokens(w.trackedTokens)}`
        : `${formatTokens(w.trackedTokens)} tok`
    const deltaPart = w.trackedDeltaPercent > 0 ? `Δ+${w.trackedDeltaPercent}% · ` : ''
    const monthlyPart =
      w.isMonthlyEligible && w.estimatedMonthlyUsd !== null
        ? `<span class="pill tone-accent num">~${escapeHtml(formatUsdCompact(w.estimatedMonthlyUsd))}/월</span>`
        : ''

    return `
      <div class="window-row">
        <div class="window-head">
          <span class="window-name" title="${escapeHtml(w.windowLabel)}">${escapeHtml(shortenWindowLabel(w.windowLabel))}</span>
          <div class="window-right">
            ${resetLabel ? `<span class="window-reset" title="리셋 예정">${escapeHtml(resetLabel)}</span>` : ''}
            <span class="window-pct num tone-text-${tone}">${pct}%</span>
          </div>
        </div>
        <div class="progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill tone-${tone}" style="width:${pct}%"></div>
        </div>
        ${
          hasActivity || monthlyPart
            ? `<div class="window-meta num">
                <span>${hasActivity ? escapeHtml(`${deltaPart}${spendText}`) : ''}</span>
                ${monthlyPart}
              </div>`
            : ''
        }
      </div>
    `
  }

  function renderAccountCard(acc, expandedIdleAccounts) {
    const allWindows = acc.windows || []
    const canCollapseIdle = allWindows.length >= 2
    const activeWindows = canCollapseIdle
      ? allWindows.filter(
          (w) => w.currentPercent > 0 || w.trackedTokens > 0 || w.trackedCostUsd > 0
        )
      : allWindows
    const idleWindows = canCollapseIdle
      ? allWindows.filter(
          (w) => w.currentPercent === 0 && w.trackedTokens === 0 && w.trackedCostUsd === 0
        )
      : []

    const primaryWindows = activeWindows.length > 0 ? activeWindows : allWindows
    const collapsibleIdle = activeWindows.length > 0 ? idleWindows : []
    const isIdleOpen = Boolean(expandedIdleAccounts && expandedIdleAccounts[acc.key])

    const displayLabel =
      acc.planType && acc.accountLabel.endsWith(`(${acc.planType})`)
        ? acc.accountLabel.slice(0, -(`(${acc.planType})`.length)).trim()
        : acc.accountLabel

    const costLabel =
      acc.totalTrackedCostUsd > 0
        ? formatUsd(acc.totalTrackedCostUsd)
        : acc.totalTrackedTokens > 0
          ? `${formatTokens(acc.totalTrackedTokens)} tok`
          : '$0.00'

    return `
      <section class="card" data-account-key="${escapeHtml(acc.key)}">
        <div class="card-header">
          <div class="card-title-wrap">
            <div class="card-title-row">
              <span class="provider-dot" style="background:${providerColor(acc.provider)}"></span>
              <span class="card-title" title="${escapeHtml(acc.accountLabel)}">${escapeHtml(displayLabel)}</span>
              ${acc.planType ? `<span class="pill">${escapeHtml(acc.planType)}</span>` : ''}
            </div>
            <div class="card-subtitle">
              ${escapeHtml(acc.providerName)} · ${acc.isActiveAccount ? '활성 계정' : '비활성'}${acc.excludedOutlierCount > 0 ? ` · 이상치 ${acc.excludedOutlierCount}건 제외` : ''}
            </div>
          </div>
          <div class="card-right">
            <span class="card-cost num">${escapeHtml(costLabel)}</span>
            ${acc.totalTrackedTokens > 0 ? `<span class="card-subtitle num">${escapeHtml(formatTokens(acc.totalTrackedTokens))} tok</span>` : ''}
          </div>
        </div>

        <div class="window-list">
          ${primaryWindows.map(renderWindowRow).join('')}
          ${
            collapsibleIdle.length > 0
              ? `
                <button type="button" class="idle-toggle" data-toggle-idle="${escapeHtml(acc.key)}">
                  ${isIdleOpen ? '▾' : '▸'} 미사용 버킷 ${collapsibleIdle.length}개 (0%)
                </button>
                ${isIdleOpen ? collapsibleIdle.map(renderWindowRow).join('') : ''}
              `
              : ''
          }
        </div>

        ${renderModelMix(acc.modelBreakdown)}
      </section>
    `
  }

  function renderOverviewTab(view, uiState) {
    const matchProvider = (p) => uiState.providerFilter === 'all' || p === uiState.providerFilter
    const accounts = (view.accounts || []).filter((a) => matchProvider(a.provider))
    const alerts = (view.degradedAlerts || []).filter((a) => matchProvider(a.provider))

    const totalCost = accounts.reduce((s, a) => s + a.totalTrackedCostUsd, 0)
    const totalTokens = accounts.reduce((s, a) => s + a.totalTrackedTokens, 0)
    const activeCount = accounts.filter((a) => a.isActiveAccount).length
    const primaryAcc = accounts.find((a) => a.primaryMonthlyUsd !== null) || null
    const primaryMonthly =
      uiState.providerFilter === 'all'
        ? view.summary?.primaryMonthlyUsd ?? primaryAcc?.primaryMonthlyUsd ?? null
        : primaryAcc?.primaryMonthlyUsd ?? null
    const primarySub =
      uiState.providerFilter === 'all'
        ? view.summary?.primaryLabel
          ? `${view.summary.primaryLabel} · ${driftMeta(view.summary.primaryStatus).label}`
          : '데이터 수집 중'
        : primaryAcc
          ? primaryAcc.providerName
          : '기준 수집 중'

    const alertHtml =
      alerts.length > 0
        ? `
          <div class="banner tone-danger" role="alert">
            <div class="banner-head"><span>⚠ 추정 월 가치 하락 의심</span></div>
            ${alerts
              .map(
                (a) =>
                  `<div class="num">${escapeHtml(a.accountLabel)} (${escapeHtml(shortenWindowLabel(a.windowLabel))}): ${escapeHtml(formatUsd(a.baselineMonthlyUsd))}/월 → ${escapeHtml(formatUsd(a.latestMonthlyUsd))}/월 (${escapeHtml(formatSignedPercent(a.vsBaselinePercent))})</div>`
              )
              .join('')}
          </div>
        `
        : ''

    if (accounts.length === 0) {
      return `
        ${alertHtml}
        <div class="empty-state">
          <div class="empty-title">추적 중인 계정이 없습니다</div>
          <div class="empty-desc">상단 새로고침(↻)을 눌러 Orca 계정 사용률(%)과 모델별 API 가치 기준점을 기록하세요.</div>
        </div>
      `
    }

    return `
      ${alertHtml}
      <div class="kpi-grid">
        <div class="kpi-tile">
          <span class="kpi-label">추적 누적 API 가치</span>
          <span class="kpi-value num">${escapeHtml(formatUsd(totalCost))}</span>
          <span class="kpi-sub num">${escapeHtml(formatTokens(totalTokens))} tok · 활성 ${activeCount}</span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-label">대표 추정 월 가치</span>
          <span class="kpi-value num">${primaryMonthly !== null ? `~${escapeHtml(formatUsdCompact(primaryMonthly))}/월` : '수집 중'}</span>
          <span class="kpi-sub">${escapeHtml(primarySub)}</span>
        </div>
      </div>
      ${accounts.map((a) => renderAccountCard(a, uiState.expandedIdleAccounts)).join('')}
    `
  }

  function renderTrendsTab(view, uiState) {
    const matchProvider = (p) => uiState.providerFilter === 'all' || p === uiState.providerFilter
    const gran = uiState.granularity === 'month' ? 'month' : 'week'
    const seriesList = (gran === 'month' ? view.monthlySeries : view.weeklySeries || []).filter((s) =>
      matchProvider(s.provider)
    )
    const rows = (gran === 'month' ? view.monthlyRows : view.weeklyRows || []).filter((r) =>
      matchProvider(r.provider)
    )
    const dropPct = view.nerfAlertDropPercent ?? 15

    const controlsHtml = `
      <div class="controls-row">
        <div class="mini-segment" role="tablist" aria-label="집계 단위">
          <button type="button" class="mini-seg-btn ${gran === 'week' ? 'is-active' : ''}" data-granularity="week">주간</button>
          <button type="button" class="mini-seg-btn ${gran === 'month' ? 'is-active' : ''}" data-granularity="month">월간</button>
        </div>
        <span class="pill">경고 -${escapeHtml(dropPct)}%</span>
      </div>
    `

    if (seriesList.length === 0) {
      return `
        ${controlsHtml}
        <div class="empty-state">
          <div class="empty-title">주간/월간 추이 데이터가 아직 없습니다</div>
          <div class="empty-desc">주간 또는 월간 쿼터가 1% 이상 상승하고 모델 비용이 집계되면 추정 월 가치($/월) 변화가 자동으로 기록됩니다.</div>
        </div>
      `
    }

    const cardsHtml = seriesList
      .map((s) => {
        const badge = driftMeta(s.status)
        const heroVal =
          s.metricKind === 'usd'
            ? formatUsd(s.latestMonthlyUsd)
            : formatTokens(s.latestTokensPerPercent)
        const heroUnit = s.metricKind === 'usd' ? '/월' : 'tok/1%'
        const subRate =
          s.metricKind === 'usd' ? `${formatUsd(s.latestUsdPerPercent)}/1%` : ''
        const prevLabel = gran === 'week' ? '전주' : '전월'
        const selectedIdx = uiState.selectedChartPoint?.[s.seriesKey]

        const deltaTone =
          s.vsBaselinePercent === null
            ? 'neutral'
            : s.status === 'degraded'
              ? 'danger'
              : s.status === 'watch'
                ? 'warning'
                : 'success'

        const excludedParts = []
        if (s.excludedOutlierCount > 0) excludedParts.push(`이상치 ${s.excludedOutlierCount}건`)
        if (s.excludedZeroCount > 0) excludedParts.push(`$0 기록 ${s.excludedZeroCount}건`)

        return `
          <section class="card">
            <div class="card-header">
              <div class="card-title-wrap">
                <div class="card-title-row">
                  <span class="provider-dot" style="background:${providerColor(s.provider)}"></span>
                  <span class="card-title">${escapeHtml(s.accountLabel)}</span>
                </div>
                <span class="card-subtitle">${escapeHtml(shortenWindowLabel(s.windowLabel))} · ${s.periodCount}개 ${gran === 'week' ? '주' : '월'} 유효</span>
              </div>
              <span class="pill tone-${badge.tone}">${escapeHtml(badge.label)}</span>
            </div>

            <div class="hero-row">
              <div class="hero-main">
                <span class="hero-value num">${escapeHtml(heroVal)}</span>
                <span class="hero-unit">${escapeHtml(heroUnit)}${subRate ? ` · ${escapeHtml(subRate)}` : ''}</span>
              </div>
              <div class="hero-deltas">
                ${
                  s.vsBaselinePercent !== null
                    ? `<span class="pill tone-${deltaTone} num">기준 ${escapeHtml(formatSignedPercent(s.vsBaselinePercent))}</span>`
                    : `<span class="pill num">Δ+${escapeHtml(s.latestDeltaPercent)}%</span>`
                }
                ${
                  s.vsPreviousPercent !== null
                    ? `<span class="card-subtitle num">${prevLabel} ${escapeHtml(formatSignedPercent(s.vsPreviousPercent))}</span>`
                    : ''
                }
              </div>
            </div>

            ${renderTrendChartSvg(s, selectedIdx, dropPct)}

            ${
              excludedParts.length > 0
                ? `<div class="card-subtitle">추이 계산에서 ${escapeHtml(excludedParts.join(' · '))} 자동 제외</div>`
                : ''
            }
          </section>
        `
      })
      .join('')

    const historyHtml = rows
      .map((r) => {
        const diffTone =
          r.baselineChangePercent !== null && r.baselineChangePercent <= -dropPct
            ? 'danger'
            : r.baselineChangePercent !== null && r.baselineChangePercent < 0
              ? 'warning'
              : 'neutral'
        const chips = (r.modelBreakdown || [])
          .slice(0, 3)
          .map(
            (m) =>
              `<span class="model-chip"><span class="model-dot" style="background:${modelColor(m.model)}"></span>${escapeHtml(m.shortName)} ${Math.round(m.sharePercent)}%</span>`
          )
          .join('')

        return `
          <div class="history-item">
            <div class="history-top">
              <div class="history-left">
                <span class="pill mono">${escapeHtml(r.periodKey)}</span>
                <span class="history-title">${escapeHtml(r.accountLabel)} · ${escapeHtml(shortenWindowLabel(r.windowLabel))}</span>
              </div>
              <span class="history-val num">${r.estimatedMonthlyUsd > 0 ? `${escapeHtml(formatUsd(r.estimatedMonthlyUsd))}/월` : `${escapeHtml(formatTokens(r.tokensPerPercent))} tok`}</span>
            </div>
            <div class="history-sub num">
              <span>Δ+${escapeHtml(r.totalDeltaPercent)}% · ${escapeHtml(formatUsd(r.usdPerPercent))}/1% · ${r.sampleCount}건</span>
              ${
                r.baselineChangePercent !== null
                  ? `<span class="tone-text-${diffTone}">기준 ${escapeHtml(formatSignedPercent(r.baselineChangePercent))}</span>`
                  : `<span>기준 구간</span>`
              }
            </div>
            ${chips ? `<div class="model-chips">${chips}</div>` : ''}
          </div>
        `
      })
      .join('')

    return `
      ${controlsHtml}
      ${cardsHtml}
      <div class="section-label">기간별 상세 (${rows.length})</div>
      <div class="history-list">${historyHtml}</div>
    `
  }

  function renderLedgerTab(view, uiState, nowMs) {
    const matchProvider = (p) => uiState.providerFilter === 'all' || p === uiState.providerFilter
    const allEntries = (view.ledgerViews || []).filter((e) => matchProvider(e.provider))
    const validEntries = allEntries.filter((e) => e.quality === 'valid')
    const showAll = Boolean(uiState.showAllLedger)
    const entries = showAll ? allEntries : validEntries
    const limit = uiState.ledgerLimit || 40
    const visible = entries.slice(0, limit)

    const filterRow = `
      <div class="controls-row">
        <div class="mini-segment" role="tablist" aria-label="기록 필터">
          <button type="button" class="mini-seg-btn ${!showAll ? 'is-active' : ''}" data-ledger-filter="valid">유효 (${validEntries.length})</button>
          <button type="button" class="mini-seg-btn ${showAll ? 'is-active' : ''}" data-ledger-filter="all">전체 (${allEntries.length})</button>
        </div>
        ${
          allEntries.length > validEntries.length
            ? `<span class="card-subtitle">제외 ${allEntries.length - validEntries.length}건</span>`
            : ''
        }
      </div>
    `

    if (visible.length === 0) {
      return `
        ${filterRow}
        <div class="empty-state">
          <div class="empty-title">${showAll ? '아직 % 변화 기록이 없습니다' : '유효한 유료 % 변화 기록이 없습니다'}</div>
          <div class="empty-desc">${
            showAll
              ? '에이전트를 사용해 쿼터 %가 1% 이상 오르면 모델별 비용과 $/1%가 자동 기록됩니다.'
              : '전체 보기에서 과거 $0 기록이나 제외된 이상치 내역을 확인할 수 있습니다.'
          }</div>
        </div>
      `
    }

    const itemsHtml = visible
      .map((e) => {
        const isExpanded = Boolean(uiState.expandedLedgerIds?.[e.id])
        const isMuted = e.quality !== 'valid'
        const costText =
          e.deltaCostUsd > 0 ? formatUsd(e.deltaCostUsd) : `${formatTokens(e.deltaTokens)} tok`
        const rateText =
          e.usdPerPercent > 0 ? `${formatUsd(e.usdPerPercent)}/1%` : ''

        const qualityBadge =
          e.quality === 'outlier'
            ? `<span class="pill tone-danger">이상치 · 제외</span>`
            : e.quality === 'zero_cost'
              ? `<span class="pill">$0 · 제외</span>`
              : ''

        const detailHtml = isExpanded
          ? `
            <div class="ledger-detail">
              ${e.qualityReason ? `<div class="tone-text-${e.quality === 'outlier' ? 'danger' : 'neutral'}">${escapeHtml(e.qualityReason)}</div>` : ''}
              ${
                (e.modelBreakdown || []).length > 0
                  ? e.modelBreakdown
                      .map(
                        (m) => `
                          <div class="detail-model">
                            <div class="detail-model-head num">
                              <span>${escapeHtml(m.shortName)}</span>
                              <span>${escapeHtml(formatUsd(m.costUsd))} (${Math.round(m.sharePercent)}%)</span>
                            </div>
                            <div class="detail-tokens num">
                              In ${escapeHtml(formatTokens(m.inputTokens))} · Out ${escapeHtml(formatTokens(m.outputTokens))} · CacheR ${escapeHtml(formatTokens(m.cacheReadTokens))} · CacheW ${escapeHtml(formatTokens(m.cacheWriteTokens))}
                            </div>
                          </div>
                        `
                      )
                      .join('')
                  : `<div class="detail-tokens">상세 모델 토큰 기록 없음 (총 ${escapeHtml(formatTokens(e.deltaTokens))} tok)</div>`
              }
              ${
                e.sessionTitles && e.sessionTitles.length > 0
                  ? `<div class="detail-tokens">세션: ${escapeHtml(e.sessionTitles.join(', '))}</div>`
                  : ''
              }
            </div>
          `
          : ''

        return `
          <div class="ledger-item ${isMuted ? 'is-muted' : ''}">
            <button type="button" class="ledger-trigger" data-toggle-ledger="${escapeHtml(e.id)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
              <div class="ledger-row-1">
                <div class="ledger-account">
                  <span class="provider-dot" style="background:${providerColor(e.provider)}"></span>
                  <span>${escapeHtml(e.accountLabel)} · ${escapeHtml(shortenWindowLabel(e.windowLabel))}</span>
                </div>
                <span class="ledger-time num">${escapeHtml(formatRelativeTime(e.timestamp, nowMs))}</span>
              </div>
              <div class="ledger-row-2">
                <span class="pill num">${e.fromPercent}% → ${e.toPercent}% (+${e.deltaPercent}%)</span>
                <span class="ledger-cost num">${escapeHtml(costText)}${rateText ? ` <span class="card-subtitle">(${escapeHtml(rateText)})</span>` : ''}</span>
              </div>
              <div class="ledger-row-1">
                <span class="ledger-sub">${escapeHtml(e.topModelsSummary !== '-' ? e.topModelsSummary : `${formatTokens(e.deltaTokens)} tok`)}</span>
                ${qualityBadge}
              </div>
            </button>
            ${detailHtml}
          </div>
        `
      })
      .join('')

    const loadMoreHtml =
      entries.length > limit
        ? `<button type="button" class="load-more-btn" data-action="load-more">더 보기 (${entries.length - limit}건 남음)</button>`
        : ''

    return `
      ${filterRow}
      <div class="ledger-list">${itemsHtml}</div>
      ${loadMoreHtml}
    `
  }

  function renderApp(view, uiState, nowMs) {
    if (!view) {
      return `
        <div class="loading-shell">
          <div class="spinner" aria-hidden="true"></div>
          <span>사용량 데이터를 불러오는 중…</span>
        </div>
      `
    }

    const providers = Array.from(
      new Set([
        ...(view.accounts || []).map((a) => a.provider),
        ...(view.weeklySeries || []).map((s) => s.provider),
        ...(view.monthlySeries || []).map((s) => s.provider)
      ])
    ).sort()

    const matchProvider = (p) => uiState.providerFilter === 'all' || p === uiState.providerFilter
    const accountCount = (view.accounts || []).filter((a) => matchProvider(a.provider)).length
    const trendCount = (
      uiState.granularity === 'month' ? view.monthlySeries || [] : view.weeklySeries || []
    ).filter((s) => matchProvider(s.provider)).length
    const validLedgerCount = (view.ledgerViews || []).filter(
      (e) => matchProvider(e.provider) && e.quality === 'valid'
    ).length

    const canExport =
      uiState.activeTab === 'trends'
        ? (uiState.granularity === 'month' ? view.monthlyRows : view.weeklyRows || []).length > 0
        : (view.ledgerViews || view.ledger || []).length > 0

    let bodyHtml = ''
    if (uiState.activeTab === 'trends') {
      bodyHtml = renderTrendsTab(view, uiState)
    } else if (uiState.activeTab === 'ledger') {
      bodyHtml = renderLedgerTab(view, uiState, nowMs)
    } else {
      bodyHtml = renderOverviewTab(view, uiState)
    }

    return `
      <header class="top-chrome">
        <div class="header-row">
          <div class="brand">
            <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 3v18h18" />
              <path d="M18 17V9" />
              <path d="M13 17V5" />
              <path d="M8 17v-3" />
            </svg>
            <span class="brand-title">Token Tracker</span>
            <span class="brand-sync num">${escapeHtml(formatRelativeTime(view.lastPollAt, nowMs))}</span>
          </div>
          <div class="header-actions">
            <button type="button" class="icon-btn ${uiState.refreshing ? 'spinning' : ''}" data-action="refresh" title="지금 측정" aria-label="지금 측정" ${uiState.refreshing ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
            </button>
            <button type="button" class="icon-btn" data-action="export" title="CSV 내보내기" aria-label="CSV 내보내기" ${canExport ? '' : 'disabled'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button type="button" class="icon-btn ${uiState.confirmReset ? 'active' : ''}" data-action="toggle-reset" title="기록 초기화" aria-label="기록 초기화">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </div>
        </div>

        <nav class="segmented-tabs" role="tablist" aria-label="보기 전환">
          <button type="button" role="tab" aria-selected="${uiState.activeTab === 'overview' ? 'true' : 'false'}" class="tab-btn ${uiState.activeTab === 'overview' ? 'is-active' : ''}" data-tab="overview">
            <span>현황</span><span class="tab-count num">${accountCount}</span>
          </button>
          <button type="button" role="tab" aria-selected="${uiState.activeTab === 'trends' ? 'true' : 'false'}" class="tab-btn ${uiState.activeTab === 'trends' ? 'is-active' : ''}" data-tab="trends">
            <span>추이</span><span class="tab-count num">${trendCount}</span>
          </button>
          <button type="button" role="tab" aria-selected="${uiState.activeTab === 'ledger' ? 'true' : 'false'}" class="tab-btn ${uiState.activeTab === 'ledger' ? 'is-active' : ''}" data-tab="ledger">
            <span>기록</span><span class="tab-count num">${validLedgerCount}</span>
          </button>
        </nav>

        ${
          providers.length > 1
            ? `
              <div class="chip-row" role="group" aria-label="프로바이더 필터">
                <button type="button" class="chip ${uiState.providerFilter === 'all' ? 'is-active' : ''}" data-provider="all">전체</button>
                ${providers
                  .map(
                    (p) =>
                      `<button type="button" class="chip ${uiState.providerFilter === p ? 'is-active' : ''}" data-provider="${escapeHtml(p)}"><span class="provider-dot" style="background:${providerColor(p)}"></span>${escapeHtml(providerName(p))}</button>`
                  )
                  .join('')}
              </div>
            `
            : ''
        }
      </header>

      <main class="content">
        ${
          uiState.confirmReset
            ? `
              <div class="banner tone-danger">
                <div class="banner-head"><span>모든 추적 기록 및 추이를 초기화할까요?</span></div>
                <div>저장된 주간/월간 기준과 % 변화 기록이 모두 삭제됩니다.</div>
                <div class="banner-actions">
                  <button type="button" class="btn-sm danger" data-action="confirm-reset">초기화 실행</button>
                  <button type="button" class="btn-sm" data-action="cancel-reset">취소</button>
                </div>
              </div>
            `
            : ''
        }
        ${
          view.lastError
            ? `
              <div class="banner tone-warning">
                <div class="banner-head"><span>스냅샷 수집 오류</span></div>
                <div>${escapeHtml(view.lastError)}</div>
              </div>
            `
            : ''
        }
        ${
          uiState.notice
            ? `
              <div class="banner tone-accent">
                <div class="banner-head">
                  <span>${escapeHtml(uiState.notice)}</span>
                  <button type="button" data-action="dismiss-notice" aria-label="닫기">✕</button>
                </div>
              </div>
            `
            : ''
        }
        ${bodyHtml}
      </main>

      <footer class="footer">
        <span>모델 단가 · 경고 기준은 플러그인 설정에서 변경</span>
        <span class="mono">v0.4.1</span>
      </footer>
    `
  }

  return {
    escapeHtml,
    formatUsd,
    formatUsdCompact,
    formatTokens,
    formatSignedPercent,
    formatRelativeTime,
    renderTrendChartSvg,
    renderApp
  }
})
