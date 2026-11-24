/**
 * Token Pulse: a token-usage dashboard contributed as one Conversation View.
 *
 * The view is a pure consumer of durable session projections — `tokenUsage`
 * and `contextPressure`/`contextBreakdown` from the host token-meter,
 * `sessionStats` from dsh-session-stats, and the turn series + model
 * attribution published by this bundle's own `tokenPulse` unit. Nothing is
 * re-folded in the browser and nothing leaves it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-token-pulse-view',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'token-pulse'
    const PLUGIN_ID = 'dsh-token-pulse-view'

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'view.pulse': 'Token 用量',
      'hero.title': '会话 Token 面板',
      'hero.subtitle': '全部数值来自服务端持久投影，与计费用量同源',
      'kpi.total': '总消耗',
      'kpi.total.hint': '输入 + 缓存 + 输出',
      'kpi.input': '输入',
      'kpi.output': '输出',
      'kpi.output.hint': '全会话累计生成 {tokens}',
      'kpi.cache': '缓存命中',
      'kpi.cache.hint': '缓存读 / 计费输入',
      'kpi.context': '上下文占用',
      'kpi.context.hint': '下次请求预估',
      'kpi.speed': '生成速度',
      'kpi.speed.hint': 'decode 均值 TPS',
      'kpi.requests': '模型请求',
      'kpi.requests.hint': '{turns} 轮 · {steps} 步',
      'section.series': '逐轮 Token 流动',
      'section.series.hint': '每根柱是一轮：输入 / 缓存读 / 缓存写 / 输出',
      'section.context': '上下文构成',
      'section.context.hint': '近似构成，用于解释占用来源',
      'section.models': '模型归因',
      'section.models.hint': '按计费权重排序',
      'section.timing': '时间去哪了',
      'section.timing.hint': '模型用时 vs 工具用时',
      'legend.input': '未缓存输入',
      'legend.cacheRead': '缓存读',
      'legend.cacheWrite': '缓存写',
      'legend.output': '输出',
      'legend.system': '系统提示',
      'legend.tools': '工具定义',
      'legend.messages': '消息与其他',
      'legend.llm': '模型生成',
      'legend.tool': '工具执行',
      'legend.idle': '间隔/等待',
      'window.last': '近 {n} 轮',
      'chart.peak': '峰值轮次',
      'window.all': '全部轮次',
      'metric.ttft': '平均首 token',
      'metric.modelTime': '模型累计',
      'metric.toolTime': '工具累计',
      'metric.turnAvg': '轮均消耗',
      'metric.session': '会话时长',
      'model.calls': '{count} 次调用',
      'model.share': '占比 {percent}%',
      'empty.title': '这条会话还没有计费请求',
      'empty.body': '发起一轮对话后，这里会实时显示逐轮 token 曲线、缓存命中、上下文占用与模型归因。',
      'context.unbounded': '路由未公布窗口上限',
      'context.toward': '逼近压缩阈值',
      'aria.series': '逐轮 token 堆叠图',
      'aria.context': '上下文占用环形图',
      'tooltip.turn': '第 {turn} 轮',
      'tooltip.total': '合计 {total}',
      'tooltip.reasoning': '其中推理',
      'tooltip.speed': '{tps} tok/s',
      'note': '数据随会话持久化；切换视图或重新打开都会完整还原。',
      'number.groupSeparator': ',',
      'number.thousand': '{value}K',
      'number.million': '{value}M',
      'number.billion': '{value}B',
      'duration.seconds': '{value} 秒',
      'duration.minutes': '{minutes} 分 {seconds} 秒',
      'duration.hours': '{hours} 时 {minutes} 分',
    }

    /** English dictionary; every Chinese key is covered. */
    const en = {
      'view.pulse': 'Token usage',
      'hero.title': 'Session token dashboard',
      'hero.subtitle': 'Every figure rides the durable host projections — same source as billing',
      'kpi.total': 'Total consumed',
      'kpi.total.hint': 'input + cache + output',
      'kpi.input': 'Input',
      'kpi.output': 'Output',
      'kpi.output.hint': 'session-wide generation {tokens}',
      'kpi.cache': 'Cache hit',
      'kpi.cache.hint': 'cache read ÷ billed input',
      'kpi.context': 'Context',
      'kpi.context.hint': 'projected next request',
      'kpi.speed': 'Decode speed',
      'kpi.speed.hint': 'average decode TPS',
      'kpi.requests': 'Model calls',
      'kpi.requests.hint': '{turns} turns · {steps} steps',
      'section.series': 'Per-turn token flow',
      'section.series.hint': 'one bar per turn: input / cache read / cache write / output',
      'section.context': 'Context composition',
      'section.context.hint': 'heuristic makeup of the next request',
      'section.models': 'Model attribution',
      'section.models.hint': 'sorted by billed weight',
      'section.timing': 'Where the time went',
      'section.timing.hint': 'model time vs tool time',
      'legend.input': 'Uncached input',
      'legend.cacheRead': 'Cache read',
      'legend.cacheWrite': 'Cache write',
      'legend.output': 'Output',
      'legend.system': 'System prompt',
      'legend.tools': 'Tool schemas',
      'legend.messages': 'Messages & other',
      'legend.llm': 'Model time',
      'legend.tool': 'Tool time',
      'legend.idle': 'Gaps / wait',
      'window.last': 'Last {n} turns',
      'chart.peak': 'peak turn',
      'window.all': 'All turns',
      'metric.ttft': 'Avg first token',
      'metric.modelTime': 'Model total',
      'metric.toolTime': 'Tool total',
      'metric.turnAvg': 'Avg / turn',
      'metric.session': 'Session span',
      'model.calls': '{count} calls',
      'model.share': '{percent}% share',
      'empty.title': 'No billed requests yet',
      'empty.body': 'Run a turn and this panel fills with the per-turn token curve, cache hits, context occupancy and model attribution.',
      'context.unbounded': 'route does not advertise a window limit',
      'context.toward': 'approaching the compaction threshold',
      'aria.series': 'Per-turn stacked token chart',
      'aria.context': 'Context occupancy gauge',
      'tooltip.turn': 'Turn {turn}',
      'tooltip.total': 'total {total}',
      'tooltip.reasoning': 'of which reasoning',
      'tooltip.speed': '{tps} tok/s',
      'note': 'State is session-derived; switching views or reopening restores everything.',
      'number.groupSeparator': ',',
      'number.thousand': '{value}K',
      'number.million': '{value}M',
      'number.billion': '{value}B',
      'duration.seconds': '{value}s',
      'duration.minutes': '{minutes}m {seconds}s',
      'duration.hours': '{hours}h {minutes}m',
    }

    /**
     * Compact token count: 517 / 12.2K / 517K / 1.2M (host chat format).
     */
    function formatTokens(value, t) {
      const scaled = (c) => (c >= 100 ? String(Math.round(c)) : String(Math.round(c * 10) / 10))
      if (value < 1_000) return String(value)
      if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
      if (value < 1_000_000_000) return t('number.million', { value: scaled(value / 1_000_000) })
      return t('number.billion', { value: scaled(value / 1_000_000_000) })
    }

    /** Exact integer with locale digit grouping. */
    function formatExact(value, t) {
      const digits = String(Math.round(value))
      const groups = []
      for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end))
      return groups.join(t('number.groupSeparator'))
    }

    /** Compact duration: 45.2s under a minute, then m/h units. */
    function formatDuration(ms, t) {
      if (!Number.isFinite(ms) || ms <= 0) return '—'
      const s = Math.round(ms / 1_000)
      if (s < 60) return t('duration.seconds', { value: (Math.round(ms / 100) / 10) })
      const whole = Math.floor(s / 60)
      if (whole < 60) return t('duration.minutes', { minutes: whole, seconds: s % 60 })
      return t('duration.hours', { hours: Math.floor(whole / 60), minutes: whole % 60 })
    }

    const SERIES_WINDOWS = [20, 50, 0]

    /** Palette: chart artwork hues; every chrome color still comes from tokens. */
    const SEGMENTS = [
      { key: 'input', legend: 'legend.input', varName: '--pulse-c-input', fallback: 'var(--dsw-alias-brand-primary)' },
      { key: 'cacheRead', legend: 'legend.cacheRead', varName: '--pulse-c-cache', fallback: 'var(--dsw-alias-state-success-primary)' },
      { key: 'cacheWrite', legend: 'legend.cacheWrite', varName: '--pulse-c-write', fallback: 'var(--dsw-alias-state-warn-primary)' },
      { key: 'output', legend: 'legend.output', varName: '--pulse-c-output', fallback: 'var(--dsw-alias-state-business-primary)' },
    ]

    /** Component styles; the module loader tags and removes this element. */
    const CSS = `
.dsh-pulse {
  --pulse-c-input: var(--dsw-alias-brand-primary);
  --pulse-c-cache: var(--dsw-alias-state-success-primary);
  --pulse-c-write: var(--dsw-alias-state-warn-primary);
  --pulse-c-output: var(--dsw-alias-state-business-primary);
  --pulse-c-system: var(--dsw-alias-chart-system, var(--dsw-alias-brand-primary));
  --pulse-c-tools: var(--dsw-alias-chart-tools, var(--dsw-alias-state-warn-primary));
  --pulse-c-msgs: var(--dsw-alias-chart-messages, var(--dsw-alias-state-success-primary));
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px calc(var(--dsh-composer-height, 152px) + 24px);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  font-size: 14px;
  line-height: 22px;
  background:
    radial-gradient(1100px 420px at 85% -140px, color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent), transparent 70%),
    var(--dsw-alias-bg-base);
}
.dsh-pulse__inner { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.dsh-pulse__hero { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 2px 2px 0; }
.dsh-pulse__heroTitle { font-size: 20px; line-height: 26px; font-weight: 600; letter-spacing: -0.01em; }
.dsh-pulse__heroSub { font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-tertiary); }
.dsh-pulse__card {
  position: relative;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-lg, 12px);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent);
  backdrop-filter: blur(14px) saturate(1.3);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
}
.dsh-pulse__kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.dsh-pulse__kpi { padding: 14px 16px 12px; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.dsh-pulse__kpi::after {
  content: '';
  position: absolute; inset: 0 0 auto; height: 2px; opacity: .9;
  background: linear-gradient(90deg, var(--pulse-accent, var(--dsw-alias-brand-primary)), transparent 55%);
}
.dsh-pulse__kpiLabel { font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-secondary); }
.dsh-pulse__kpiValue {
  font-size: 26px; line-height: 34px; font-weight: 650; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  transition: color 240ms ease;
}
.dsh-pulse__kpiValue small { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-tertiary); margin-left: 3px; letter-spacing: 0; }
.dsh-pulse__kpiHint { font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); }
.dsh-pulse__spark { position: absolute; right: 12px; bottom: 10px; width: 120px; height: 30px; opacity: .85; }
.dsh-pulse__row2 { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 12px; align-items: stretch; }
.dsh-pulse__row3 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: stretch; }
.dsh-pulse__panel { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dsh-pulse__panelHead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.dsh-pulse__panelTitle { font: var(--dsw-font-xs-strong-13); color: var(--dsw-alias-label-primary); }
.dsh-pulse__panelHint { font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); text-align: right; }
.dsh-pulse__legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-secondary); }
.dsh-pulse__legendItem { display: inline-flex; align-items: center; gap: 5px; }
.dsh-pulse__legendSwatch { width: 8px; height: 8px; border-radius: 2.5px; background: var(--sw, var(--dsw-alias-brand-primary)); }
.dsh-pulse__window { display: flex; gap: 3px; padding: 2px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 999px; }
.dsh-pulse__windowButton {
  appearance: none; border: 0; background: transparent; cursor: pointer;
  border-radius: 999px; padding: 2px 10px;
  font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-secondary);
}
.dsh-pulse__windowButton[data-active='true'] {
  background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); font-weight: 600;
}
.dsh-pulse__chart { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-pulse__bars { display: flex; align-items: flex-end; gap: 3px; height: 168px; min-width: 0; }
.dsh-pulse__bars--dense { gap: 0.5px; }
.dsh-pulse__bars--dense .dsh-pulse__bar { min-width: 1px; }
.dsh-pulse__bars--dense .dsh-pulse__seg { border-radius: 1px; }
.dsh-pulse__bar {
  position: relative; flex: 1 1 0; min-width: 2px; height: 100%;
  display: flex; flex-direction: column; justify-content: flex-end; gap: 1px;
  border-radius: 3px; cursor: default;
  transition: background 120ms ease;
}
.dsh-pulse__bar:hover, .dsh-pulse__bar[data-focus='true'] { background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); }
.dsh-pulse__seg { width: 100%; border-radius: 2px; transition: height 300ms cubic-bezier(.2,.8,.3,1); }
.dsh-pulse__seg[data-k='input'] { background: var(--pulse-c-input); }
.dsh-pulse__seg[data-k='cacheRead'] { background: var(--pulse-c-cache); opacity: .85; }
.dsh-pulse__seg[data-k='cacheWrite'] { background: var(--pulse-c-write); opacity: .8; }
.dsh-pulse__seg[data-k='output'] { background: var(--pulse-c-output); border-radius: 3px 3px 2px 2px; }
.dsh-pulse__baseline { display: flex; justify-content: space-between; font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); }
.dsh-pulse__tip {
  position: absolute; z-index: 3; pointer-events: none;
  left: var(--tip-x, 0); top: 4px;
  transform: translateX(-50%);
  min-width: 172px; padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
  font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-primary);
}
.dsh-pulse__tipTurn { font-weight: 600; margin-bottom: 4px; }
.dsh-pulse__tipRow { display: flex; justify-content: space-between; gap: 14px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsh-pulse__tipRow b { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-pulse__gauge { display: flex; align-items: center; gap: 16px; padding: 2px 0; }
.dsh-pulse__gaugeSvg { width: 128px; height: 128px; flex: none; }
.dsh-pulse__gaugeTrack { stroke: var(--dsw-alias-border-l2); }
.dsh-pulse__gaugeArc { transition: stroke-dashoffset 500ms cubic-bezier(.2,.8,.3,1), stroke 240ms ease; stroke-linecap: round; }
.dsh-pulse__gaugeCenter { display: grid; gap: 1px; place-items: center; }
.dsh-pulse__gaugePercent { font-size: 24px; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.dsh-pulse__gaugeCaption { font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); }
.dsh-pulse__stackWrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.dsh-pulse__stack { display: flex; height: 12px; border-radius: 999px; overflow: hidden; background: var(--dsw-alias-border-l2); }
.dsh-pulse__stackSeg { transition: width 420ms cubic-bezier(.2,.8,.3,1); }
.dsh-pulse__stackLegend { display: grid; gap: 4px; font: var(--dsw-font-xxs-12); }
.dsh-pulse__stackLegend > div { display: flex; align-items: center; gap: 7px; color: var(--dsw-alias-label-secondary); }
.dsh-pulse__stackLegend b { margin-left: auto; color: var(--dsw-alias-label-primary); font-weight: 500; font-variant-numeric: tabular-nums; }
.dsh-pulse__models { display: grid; gap: 8px; }
.dsh-pulse__model { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; align-items: center; }
.dsh-pulse__modelName { font: var(--dsw-font-xs-strong-13); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pulse__modelMeta { font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); text-align: right; font-variant-numeric: tabular-nums; }
.dsh-pulse__modelBar { grid-column: 1 / -1; height: 6px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--dsw-alias-border-l2) 70%, transparent); }
.dsh-pulse__modelFill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--pulse-c-input), var(--pulse-c-output)); transition: width 420ms cubic-bezier(.2,.8,.3,1); }
.dsh-pulse__timing { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: var(--dsw-alias-border-l2); }
.dsh-pulse__metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 16px; font: var(--dsw-font-xxs-12); }
.dsh-pulse__metric { display: flex; justify-content: space-between; gap: 10px; color: var(--dsw-alias-label-secondary); }
.dsh-pulse__metric b { color: var(--dsw-alias-label-primary); font-weight: 500; font-variant-numeric: tabular-nums; }
.dsh-pulse__empty { padding: 48px 24px; text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center; }
.dsh-pulse__emptyTitle { font: var(--dsw-font-s-strong-14); }
.dsh-pulse__emptyBody { max-width: 420px; font: var(--dsw-font-xs-13); color: var(--dsw-alias-label-tertiary); line-height: 1.6; }
.dsh-pulse__note { text-align: center; font: var(--dsw-font-xxxs-11); color: var(--dsw-alias-label-tertiary); margin: 0; }
.dsh-pulse__windowButton:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .dsh-pulse__seg, .dsh-pulse__gaugeArc, .dsh-pulse__stackSeg, .dsh-pulse__modelFill { transition: none; }
}
@media (width <= 1000px) {
  .dsh-pulse__kpis { grid-template-columns: repeat(2, 1fr); }
  .dsh-pulse__row2, .dsh-pulse__row3 { grid-template-columns: 1fr; }
}
`

    const TAG_ID = `${PLUGIN_ID}/pulse.css`
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * Read a projected object with defaulted numeric fields.
     */
    function usageView(usage) {
      const u = usage ?? {}
      const input = u.uncachedInputTokens ?? 0
      const cacheRead = u.cacheReadTokens ?? 0
      const cacheWrite = u.cacheWriteTokens ?? 0
      const output = u.outputTokens ?? 0
      const billedInput = input + cacheRead + cacheWrite
      return { input, cacheRead, cacheWrite, output, billedInput, total: billedInput + output }
    }

    /**
     * Smoothed sparkline path for one numeric series.
     */
    function sparkPath(values, width, height) {
      if (values.length < 2) return null
      const max = Math.max(...values, 1)
      const step = width / (values.length - 1)
      let d = ''
      values.forEach((value, index) => {
        const x = index * step
        const y = height - (value / max) * (height - 2) - 1
        d += index === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
      })
      return d
    }

    /**
     * One KPI card: label, big figure, hint, and an optional sparkline.
     */
    function KpiCard(props) {
      const { label, value, unit, hint, accent, spark } = props
      const path = spark && spark.length > 1 ? sparkPath(spark, 120, 30) : null
      return h('div', { className: 'dsh-pulse__card dsh-pulse__kpi', style: { '--pulse-accent': accent } },
        h('span', { className: 'dsh-pulse__kpiLabel' }, label),
        h('span', { className: 'dsh-pulse__kpiValue' },
          value,
          unit == null ? null : h('small', null, unit)),
        hint == null ? null : h('span', { className: 'dsh-pulse__kpiHint' }, hint),
        path === null ? null : h('svg', {
          className: 'dsh-pulse__spark', viewBox: '0 0 120 30', 'aria-hidden': true, preserveAspectRatio: 'none',
        },
        h('path', { d: `${path} L120,30 L0,30 Z`, fill: accent, opacity: .09, stroke: 'none' }),
        h('path', { d: path, fill: 'none', stroke: accent, strokeWidth: 1.4, opacity: .75 })))
    }

    /**
     * Panel chrome: title row with an optional right-side control, then body.
     */
    function Panel(props) {
      const { title, hint, actions, children, className } = props
      return h('section', { className: `dsh-pulse__card dsh-pulse__panel${className ? ` ${className}` : ''}` },
        h('div', { className: 'dsh-pulse__panelHead' },
          h('span', { className: 'dsh-pulse__panelTitle' }, title),
          actions ?? (hint == null ? null : h('span', { className: 'dsh-pulse__panelHint' }, hint))),
        children)
    }

    /**
     * Stacked per-turn bars with a hover/keyboard tooltip.
     */
    function SeriesChart(props) {
      const { rows, t } = props
      const [focus, setFocus] = React.useState(null)
      const totals = rows.map(row => (row.input + (row.cacheRead ?? 0) + (row.cacheWrite ?? 0) + row.output))
      const max = Math.max(...totals, 1)
      // Clamp: a window switch can shrink `rows` under a focus index set by
      // hover, and an unmounted bar never fires its mouseleave.
      const tipIndex = focus !== null && focus < rows.length ? focus : null
      const hovered = tipIndex === null ? null : rows[tipIndex]
      const bars = rows.map((row, index) => {
        // Rendered in a column: the first child sits on top. Output is the
        // small segment, so it stays visible above the dominant input base.
        const parts = [
          ['output', row.output],
          ['cacheWrite', row.cacheWrite ?? 0],
          ['cacheRead', row.cacheRead ?? 0],
          ['input', row.input],
        ]
        return h('div', {
          key: row.turn,
          className: 'dsh-pulse__bar',
          role: 'listitem',
          'data-focus': focus === index ? 'true' : 'false',
          'aria-label': `${t('tooltip.turn', { turn: row.turn })}: ${formatTokens(totals[index], t)}`,
          onMouseEnter: () => { setFocus(index) },
          onMouseLeave: () => { setFocus(current => (current === index ? null : current)) },
        },
        parts.map(([key, value]) => value <= 0 ? null : h('div', {
          key,
          className: 'dsh-pulse__seg',
          'data-k': key,
          style: { height: `${Math.max(1.5, (value / max) * 100).toFixed(2)}%` },
        })))
      })
      // Dense mode: past 90 turns the gap and minimum width shrink so the row
      // still fits the card instead of overflowing it.
      const dense = rows.length > 90
      const tipLeft = tipIndex === null ? 0 : Math.min(88, Math.max(12, ((tipIndex + 0.5) / rows.length) * 100))
      const row = hovered
      const rowTotal = row === null ? 0 : row.input + (row.cacheRead ?? 0) + (row.cacheWrite ?? 0) + row.output
      const tps = row !== null && row.decodeMs > 0 ? Math.round(row.decodeTokens / (row.decodeMs / 1000)) : null
      return h('div', { className: 'dsh-pulse__chart', role: 'group', 'aria-label': t('aria.series') },
        h('div', {
          className: dense ? 'dsh-pulse__bars dsh-pulse__bars--dense' : 'dsh-pulse__bars',
          role: 'list',
          'aria-label': t('aria.series'),
          tabIndex: 0,
          onKeyDown: (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            setFocus(current => {
              const base = current === null || current >= rows.length
                ? (event.key === 'ArrowRight' ? -1 : rows.length)
                : current
              const next = event.key === 'ArrowRight' ? base + 1 : base - 1
              return next < 0 || next >= rows.length ? current : next
            })
          },
        }, bars),
        h('div', { className: 'dsh-pulse__baseline' },
          h('span', null, rows.length > 0 ? `#${rows[0].turn}` : ''),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
            `${formatTokens(max, t)} · ${t('chart.peak')}`),
          h('span', null, rows.length > 0 ? `#${rows[rows.length - 1].turn}${rows[rows.length - 1].closed ? '' : ' ···'}` : '')),
        row === null ? null : h('div', { className: 'dsh-pulse__tip', style: { '--tip-x': `${tipLeft}%` } },
          h('div', { className: 'dsh-pulse__tipTurn' }, t('tooltip.turn', { turn: row.turn }), ' · ', t('tooltip.total', { total: formatExact(rowTotal, t) })),
                    h('div', { className: 'dsh-pulse__tipRow' }, h('span', null, t('legend.input')), h('b', null, formatExact(row.input, t))),
          row.cacheRead == null ? null : h('div', { className: 'dsh-pulse__tipRow' }, h('span', null, t('legend.cacheRead')), h('b', null, formatExact(row.cacheRead, t))),
          row.cacheWrite == null ? null : h('div', { className: 'dsh-pulse__tipRow' }, h('span', null, t('legend.cacheWrite')), h('b', null, formatExact(row.cacheWrite, t))),
          h('div', { className: 'dsh-pulse__tipRow' }, h('span', null, t('legend.output')), h('b', null, formatExact(row.output, t))),
          row.reasoning != null ? h('div', { className: 'dsh-pulse__tipRow' }, h('span', null, t('tooltip.reasoning')), h('b', null, formatExact(row.reasoning, t))) : null,
          row.ttftSteps > 0 ? h('div', { className: 'dsh-pulse__tipRow' }, h('span', null, t('metric.ttft')), h('b', null, formatDuration(row.ttftMs / row.ttftSteps, t))) : null,
          tps !== null ? h('div', { className: 'dsh-pulse__tipRow' }, h('span', null, t('kpi.speed')), h('b', null, t('tooltip.speed', { tps }))) : null,
          row.models.length > 0 ? h('div', { className: 'dsh-pulse__tipRow' }, h('span', null, t('section.models')), h('b', null, row.models.join(', '))) : null))
    }

    /**
     * Context occupancy: donut gauge plus a composition stack.
     */
    function ContextGauge(props) {
      const { pressure, breakdown, t } = props
      const used = pressure.projectedTokens ?? pressure.pressureTokens
      const cap = pressure.contextWindow
      const fraction = typeof used === 'number' && typeof cap === 'number' && cap > 0
        ? Math.min(1, used / cap)
        : null
      const radius = 54
      const circumference = 2 * Math.PI * radius
      const warn = fraction !== null && fraction >= 0.8
      const arcColor = fraction === null
        ? 'var(--dsw-alias-border-l3)'
        : warn
          ? 'var(--dsw-alias-state-warn-primary)'
          : fraction >= 0.55
            ? 'var(--dsw-alias-state-business-primary)'
            : 'var(--dsw-alias-brand-primary)'
      const parts = breakdown == null ? null : [
        { key: 'system', label: t('legend.system'), value: breakdown.systemTokens, sw: 'var(--pulse-c-system)' },
        { key: 'tools', label: t('legend.tools'), value: breakdown.toolsTokens, sw: 'var(--pulse-c-tools)' },
        { key: 'messages', label: t('legend.messages'), value: breakdown.messageTokens, sw: 'var(--pulse-c-msgs)' },
      ]
      const partTotal = parts === null ? 0 : parts.reduce((sum, part) => sum + part.value, 0)
      return h('div', { className: 'dsh-pulse__gauge' },
        h('div', { className: 'dsh-pulse__gaugeSvg dsh-pulse__gaugeCenter', style: { position: 'relative' }, role: 'img', 'aria-label': t('aria.context') },
          h('svg', { viewBox: '0 0 128 128', style: { position: 'absolute', inset: 0 } },
            h('circle', { className: 'dsh-pulse__gaugeTrack', cx: 64, cy: 64, r: radius, fill: 'none', strokeWidth: 10 }),
            h('circle', {
              className: 'dsh-pulse__gaugeArc', cx: 64, cy: 64, r: radius, fill: 'none', strokeWidth: 10,
              stroke: arcColor,
              strokeDasharray: `${circumference} ${circumference}`,
              strokeDashoffset: circumference * (1 - (fraction ?? 0)),
              transform: 'rotate(-90 64 64)',
            })),
          h('span', { className: 'dsh-pulse__gaugePercent' },
            fraction === null ? '—' : `${Math.round(fraction * 100)}%`),
          h('span', { className: 'dsh-pulse__gaugeCaption' },
            typeof used === 'number' ? `${formatTokens(used, t)} / ${cap === undefined ? '—' : formatTokens(cap, t)}` : t('kpi.context'))),
        h('div', { className: 'dsh-pulse__stackWrap' },
          fraction === null ? h('div', { className: 'dsh-pulse__panelHint', style: { textAlign: 'left' } }, t('context.unbounded')) : null,
          warn ? h('div', { className: 'dsh-pulse__kpiHint', style: { color: 'var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary))' } }, t('context.toward')) : null,
          parts === null || partTotal === 0 ? null : h('div', { className: 'dsh-pulse__stack' },
            parts.map(part => part.value <= 0 ? null : h('div', {
              key: part.key,
              className: 'dsh-pulse__stackSeg',
              style: { width: `${(part.value / partTotal * 100).toFixed(2)}%`, background: part.sw },
            }))),
          parts === null || partTotal === 0 ? null : h('div', { className: 'dsh-pulse__stackLegend' },
            parts.map(part => h('div', { key: part.key },
              h('span', { className: 'dsh-pulse__legendSwatch', style: { '--sw': part.sw } }),
              part.label,
              h('b', null, `${formatTokens(part.value, t)}`))),
            h('div', null, h('span', null), t('kpi.context.hint'),
              h('b', null, typeof used === 'number' ? formatTokens(used, t) : '—')))))
    }

    /**
     * Model attribution rows with share bars.
     */
    function ModelPanel(props) {
      const { models, t } = props
      const weighted = models.map(model => ({
        ...model,
        weight: model.input + model.cacheRead + model.cacheWrite + model.output,
      }))
      const max = Math.max(...weighted.map(model => model.weight), 1)
      const sum = weighted.reduce((total, model) => total + model.weight, 0)
      return h('div', { className: 'dsh-pulse__models' },
        weighted.map(model => h('div', { key: `${model.provider}/${model.model}`, className: 'dsh-pulse__model' },
          h('span', { className: 'dsh-pulse__modelName', title: `${model.provider}/${model.model}` }, model.model),
          h('span', { className: 'dsh-pulse__modelMeta' },
            `${formatTokens(model.weight, t)} · ${t('model.calls', { count: model.calls })}`),
          h('div', { className: 'dsh-pulse__modelBar', title: t('model.share', { percent: sum === 0 ? 0 : Math.round(model.weight / sum * 100) }) },
            h('div', { className: 'dsh-pulse__modelFill', style: { width: `${(model.weight / max * 100).toFixed(2)}%` } })))))
    }

    /**
     * The dashboard component bound to one session's projection seats.
     */
    function PulseView(props) {
      const t = typeof props.t === 'function' ? props.t : key => key
      const useProjection = props.useProjection
      const usage = usageView(useProjection == null ? undefined : useProjection('tokenUsage'))
      const stats = useProjection == null ? undefined : useProjection('sessionStats')
      const pressure = useProjection == null ? undefined : useProjection('contextPressure')
      const breakdown = useProjection == null ? undefined : useProjection('contextBreakdown')
      const pulse = useProjection == null ? undefined : useProjection('tokenPulse')

      const [windowIndex, setWindowIndex] = React.useState(0)
      const series = pulse?.series ?? []
      const limit = SERIES_WINDOWS[windowIndex]
      const rows = limit === 0 ? series : series.slice(-limit)

      if (usage.total === 0 && series.length === 0) {
        return h('div', { className: 'dsh-pulse' },
          h('div', { className: 'dsh-pulse__inner' },
            h('div', { className: 'dsh-pulse__card dsh-pulse__empty' },
              h('div', { className: 'dsh-pulse__heroTitle' }, t('empty.title')),
              h('p', { className: 'dsh-pulse__emptyBody' }, t('empty.body'))),
            h('p', { className: 'dsh-pulse__note' }, t('note'))))
      }

      const billedTotal = usage.total
      const cacheHit = usage.billedInput > 0 ? (usage.cacheRead / usage.billedInput) * 100 : null
      const avgTps = stats && stats.decodeMs > 0 ? Math.round(stats.decodeTokens / (stats.decodeMs / 1000)) : null
      const avgTtft = stats && stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : null
      const turnCount = stats?.turns ?? pulse?.totals?.turns ?? series.length
      const stepCount = stats?.steps ?? pulse?.totals?.steps ?? 0
      const llmMs = stats?.llmMs ?? pulse?.totals?.llmMs ?? 0
      const toolMs = stats?.toolMs ?? pulse?.totals?.toolMs ?? 0
      const spanMs = pulse?.totals?.firstTime != null && pulse?.totals?.lastTime != null
        ? pulse.totals.lastTime - pulse.totals.firstTime
        : 0
      const wallBase = Math.max(spanMs, llmMs + toolMs, 1)
      const idleMs = Math.max(0, wallBase - llmMs - toolMs)
      const turnAvg = turnCount > 0 ? billedTotal / turnCount : 0
      const SPARK_MAX = 32
      const tail = series.length > SPARK_MAX ? series.slice(-SPARK_MAX) : series
      const outSpark = tail.map(row => row.output)
      const cacheSpark = tail.map(row => row.cacheRead ?? 0)
      const totalSpark = tail.map(row => row.input + (row.cacheRead ?? 0) + (row.cacheWrite ?? 0) + row.output)

      const gaugeColorInput = 'var(--pulse-c-input)'
      const gaugeColorOutput = 'var(--pulse-c-output)'

      return h('div', { className: 'dsh-pulse' },
        h('div', { className: 'dsh-pulse__inner' },
          h('div', { className: 'dsh-pulse__hero' },
            h('div', null,
              h('div', { className: 'dsh-pulse__heroTitle' }, t('hero.title')),
              h('div', { className: 'dsh-pulse__heroSub' }, t('hero.subtitle')))),
          h('div', { className: 'dsh-pulse__kpis' },
            h(KpiCard, {
              label: t('kpi.total'), value: formatTokens(billedTotal, t), hint: t('kpi.total.hint'),
              accent: gaugeColorInput, spark: totalSpark,
            }),
            h(KpiCard, {
              label: t('kpi.output'), value: formatTokens(usage.output, t), hint: t('kpi.output.hint', { tokens: formatTokens(usage.output, t) }),
              accent: gaugeColorOutput, spark: outSpark,
            }),
            h(KpiCard, {
              label: t('kpi.cache'),
              value: cacheHit === null ? '—' : `${cacheHit.toFixed(cacheHit < 10 ? 1 : 0)}`, unit: '%',
              hint: t('kpi.cache.hint'),
              accent: 'var(--pulse-c-cache)', spark: cacheSpark,
            }),
            h(KpiCard, {
              label: t('kpi.speed'),
              value: avgTps === null ? '—' : String(avgTps), unit: 'tok/s',
              hint: t('kpi.speed.hint'),
              accent: 'var(--pulse-c-write)', spark: tail.map(row => row.decodeMs > 0 ? row.output / (row.decodeMs / 1000) : 0),
            })),
          h('div', { className: 'dsh-pulse__card dsh-pulse__panel' },
            h('div', { className: 'dsh-pulse__panelHead' },
              h('div', null,
                h('span', { className: 'dsh-pulse__panelTitle' }, t('section.series')),
                h('span', { className: 'dsh-pulse__panelHint', style: { marginLeft: 10 } }, t('section.series.hint'))),
              h('div', { className: 'dsh-pulse__window', role: 'group', 'aria-label': t('section.series') },
                SERIES_WINDOWS.map((candidate, index) => h('button', {
                  key: candidate,
                  type: 'button',
                  className: 'dsh-pulse__windowButton',
                  'aria-pressed': index === windowIndex,
                  'data-active': index === windowIndex ? 'true' : 'false',
                  onClick: () => { setWindowIndex(index) },
                }, candidate === 0 ? t('window.all') : t('window.last', { n: candidate }))))),
            h(SeriesChart, { rows, t }),
            h('div', { className: 'dsh-pulse__legend' },
              SEGMENTS.map(segment => h('span', { key: segment.key, className: 'dsh-pulse__legendItem' },
                h('span', { className: 'dsh-pulse__legendSwatch', style: { '--sw': `var(${segment.varName})` } }),
                t(segment.legend))))),
          h('div', { className: 'dsh-pulse__row2' },
            h(Panel, { title: t('section.context'), hint: t('section.context.hint') },
              h(ContextGauge, { pressure: pressure ?? {}, breakdown: breakdown ?? null, t })),
            h(Panel, { title: t('section.models'), hint: t('section.models.hint') },
              (pulse?.models?.length ?? 0) === 0
                ? h('div', { className: 'dsh-pulse__panelHint' }, '—')
                : h(ModelPanel, { models: pulse.models, t }))),
          h('div', { className: 'dsh-pulse__row3' },
            h(Panel, { title: t('section.timing'), hint: t('section.timing.hint') },
              h('div', { className: 'dsh-pulse__timing' },
                h('div', { className: 'dsh-pulse__stackSeg', style: { width: `${(llmMs / wallBase * 100).toFixed(2)}%`, background: 'var(--pulse-c-output)' } }),
                h('div', { className: 'dsh-pulse__stackSeg', style: { width: `${(toolMs / wallBase * 100).toFixed(2)}%`, background: 'var(--pulse-c-cache)' } }),
                h('div', { className: 'dsh-pulse__stackSeg', style: { width: `${(idleMs / wallBase * 100).toFixed(2)}%`, background: 'var(--dsw-alias-border-l3)' } })),
              h('div', { className: 'dsh-pulse__legend' },
                h('span', { className: 'dsh-pulse__legendItem' }, h('span', { className: 'dsh-pulse__legendSwatch', style: { '--sw': 'var(--pulse-c-output)' } }), `${t('legend.llm')} · ${formatDuration(llmMs, t)}`),
                h('span', { className: 'dsh-pulse__legendItem' }, h('span', { className: 'dsh-pulse__legendSwatch', style: { '--sw': 'var(--pulse-c-cache)' } }), `${t('legend.tool')} · ${formatDuration(toolMs, t)}`),
                h('span', { className: 'dsh-pulse__legendItem' }, h('span', { className: 'dsh-pulse__legendSwatch', style: { '--sw': 'var(--dsw-alias-border-l3)' } }), `${t('legend.idle')} · ${formatDuration(idleMs, t)}`))),
            h(Panel, { title: t('kpi.requests'), hint: t('kpi.requests.hint', { turns: turnCount, steps: stepCount }) },
              h('div', { className: 'dsh-pulse__metrics' },
                h('div', { className: 'dsh-pulse__metric' }, t('metric.turnAvg'), h('b', null, `${formatTokens(turnAvg, t)} tok`)),
                h('div', { className: 'dsh-pulse__metric' }, t('metric.ttft'), h('b', null, avgTtft === null ? '—' : formatDuration(avgTtft, t))),
                h('div', { className: 'dsh-pulse__metric' }, t('metric.modelTime'), h('b', null, formatDuration(llmMs, t))),
                h('div', { className: 'dsh-pulse__metric' }, t('metric.toolTime'), h('b', null, formatDuration(toolMs, t))),
                h('div', { className: 'dsh-pulse__metric' }, t('metric.session'), h('b', null, spanMs > 0 ? formatDuration(spanMs, t) : '—')),
                h('div', { className: 'dsh-pulse__metric' }, t('kpi.input'), h('b', null, formatExact(usage.input, t))),
                h('div', { className: 'dsh-pulse__metric' }, t('legend.cacheRead'), h('b', null, formatExact(usage.cacheRead, t))),
                h('div', { className: 'dsh-pulse__metric' }, t('legend.cacheWrite'), h('b', null, formatExact(usage.cacheWrite, t)))))),
          h('p', { className: 'dsh-pulse__note' }, t('note'))))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'token-pulse: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'token-pulse: en dictionary')
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'token-pulse',
          order: 30,
          locale: NS,
          label: () => t('view.pulse'),
        }, PulseView))
      },
    }
  },
})
