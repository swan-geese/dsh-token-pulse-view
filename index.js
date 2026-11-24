/**
 * Host half of the Token Pulse dashboard bundle.
 *
 * Registers one `tokenPulse` session-projection unit: a pure fold of the
 * durable log that publishes what the host's own projections do not carry as
 * a client value — (1) a turn-scoped token series with per-bucket billing and
 * timing, (2) per-provider/model attribution, and (3) whole-log timing
 * boundaries. Every other dashboard figure rides `tokenUsage`, `sessionStats`,
 * `contextPressure`, and `contextBreakdown` directly.
 *
 * Billing follows the token-meter rule exactly: one last-wins usage sample per
 * turn/step slot; `llm/retry-started` closes the slot so the retried attempt
 * bills on top instead of replacing. Timing mirrors dsh-session-stats: steps
 * count `step/end` (the lifecycle authority), model time spans step/start →
 * assistant/message, first token survives an in-step retry, tool time pairs
 * `tool/call` → `tool/result` by callId.
 *
 * The bundle imports nothing: stream helpers are the same pure scans
 * dsh-llm exposes, re-implemented locally so the host half resolves from the
 * profile directory alone, and the projection registry only calls `.parse`
 * on its two schema slots, which a pass-through satisfies without zod.
 */

export const inject = ['sessionProjections']

/** Schema stand-in accepted by the registry (`parse` is the only method it calls). */
const passthrough = { parse: (value) => value }

/** Chart rows kept for the series; older turns stay billed in totals but drop from the series. */
const SERIES_CAP = 400

const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

/** Whether one raw stream chunk carries reader-visible token output (dsh-llm isTokenDelta). */
function isTokenDelta(chunk) {
  switch (chunk?.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/** Wall time of the first token-producing chunk record, or null. */
function firstTokenTimeOf(stream) {
  if (!Array.isArray(stream)) return null
  for (const record of stream) {
    if (record?.type === 'chunk' && isTokenDelta(record.chunk)) return num(record.time) || null
  }
  return null
}

/** The last `usage` chunk of one compact stream, or undefined. */
function lastUsageChunk(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record?.type === 'chunk' && record.chunk?.type === 'usage') return record.chunk
  }
  return undefined
}

/** Read one provider-reported usage record into disjoint buckets (null = bucket never reported). */
function bucketsOf(usage) {
  if (usage === null || typeof usage !== 'object') return null
  if (typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') return null
  return {
    input: num(usage.inputTokens),
    output: num(usage.outputTokens),
    cacheRead: usage.cacheReadTokens === undefined ? null : num(usage.cacheReadTokens),
    cacheWrite: usage.cacheWriteTokens === undefined ? null : num(usage.cacheWriteTokens),
    reasoning: usage.reasoningTokens === undefined ? null : num(usage.reasoningTokens),
  }
}

function emptyTurn(turn, time) {
  return {
    turn,
    startTime: time,
    endTime: null,
    closed: false,
    steps: 0,
    input: 0,
    output: 0,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    llmMs: 0,
    toolMs: 0,
    models: [],
  }
}

/** Add (or subtract) one bucket sample into a row whose optional buckets are last-wins sums. */
function addInto(row, buckets, sign) {
  row.input += sign * buckets.input
  row.output += sign * buckets.output
  if (buckets.cacheRead !== null) row.cacheRead = (row.cacheRead ?? 0) + sign * buckets.cacheRead
  if (buckets.cacheWrite !== null) row.cacheWrite = (row.cacheWrite ?? 0) + sign * buckets.cacheWrite
  if (buckets.reasoning !== null) row.reasoning = (row.reasoning ?? 0) + sign * buckets.reasoning
}

/** Route of one settled message; null when provider/model attribution is absent. */
function routeOf(message) {
  const source = message !== null && typeof message === 'object' ? message.source : null
  const provider = typeof source?.provider === 'string' ? source.provider : ''
  const model = typeof source?.model === 'string' ? source.model : ''
  return provider !== '' && model !== '' ? { provider, model } : null
}

/**
 * Bill one usage sample against the turn/step slot with last-wins replacement;
 * a replacement updates already-booked row and model sums by its delta, while
 * a fresh sample on a closed (retried) slot adds on top.
 */
function settleSample(state, turn, step, buckets, route) {
  const slot = state.slot
  const sameSlot = slot !== null && slot.turn === turn && slot.step === step
  const previous = sameSlot && slot.buckets !== null ? slot.buckets : null
  const previousKey = sameSlot ? slot.key : null
  const currentKey = route === null ? null : `${route.provider}/${route.model}`

  const series = state.series.map((row) => {
    if (row.turn !== turn) return row
    const next = { ...row }
    if (previous !== null) addInto(next, previous, -1)
    addInto(next, buckets, 1)
    if (currentKey !== null && !next.models.includes(currentKey)) next.models = [...next.models, currentKey]
    return next
  })

  let models = state.models
  if (currentKey !== null) {
    // Attribution mirrors billing but only route-attributed samples ever land
    // on a model entry. A same-route replacement adjusts by its delta; a
    // replacement whose previous sample was unattributed (or belonged to
    // another route) bills the fresh sample whole, and the stale route's
    // entry — if any — gives the previous sample back.
    const sameRouteReplacement = previous !== null && previousKey === currentKey
    if (previous !== null && previousKey !== null && previousKey !== currentKey) {
      const stale = models[previousKey]
      if (stale !== undefined) {
        models = {
          ...models,
          [previousKey]: {
            ...stale,
            input: stale.input - previous.input,
            output: stale.output - previous.output,
            cacheRead: stale.cacheRead - (previous.cacheRead ?? 0),
            cacheWrite: stale.cacheWrite - (previous.cacheWrite ?? 0),
            calls: Math.max(0, stale.calls - 1),
          },
        }
      }
    }
    const offset = sameRouteReplacement ? previous : null
    const before = models[currentKey]
    models = {
      ...models,
      [currentKey]: {
        provider: route.provider,
        model: route.model,
        input: (before?.input ?? 0) + buckets.input - (offset?.input ?? 0),
        output: (before?.output ?? 0) + buckets.output - (offset?.output ?? 0),
        cacheRead: (before?.cacheRead ?? 0) + (buckets.cacheRead ?? 0) - (offset?.cacheRead ?? 0),
        cacheWrite: (before?.cacheWrite ?? 0) + (buckets.cacheWrite ?? 0) - (offset?.cacheWrite ?? 0),
        // Only a same-route replacement keeps the call count; every other
        // arrival is a first attribution for this sample.
        calls: offset === null ? (before?.calls ?? 0) + 1 : before?.calls ?? 1,
      },
    }
  }

  return {
    ...state,
    slot: { turn, step, buckets, key: currentKey },
    series: series.length > SERIES_CAP ? series.slice(-SERIES_CAP) : series,
    models,
  }
}

/** Book one settled step's wall times into its turn row, once per turn/step slot. */
function bookTiming(state, turn, step, llmMs, ttftMs, decodeMs, outputTokens) {
  const already = state.timedStep !== null && state.timedStep.turn === turn && state.timedStep.step === step
  if (already) return state
  const series = state.series.map((row) => {
    if (row.turn !== turn) return row
    const next = { ...row, llmMs: row.llmMs + llmMs }
    if (ttftMs !== null) {
      next.ttftMs += ttftMs
      next.ttftSteps += 1
      if (decodeMs !== null && outputTokens > 0) {
        next.decodeMs += decodeMs
        next.decodeTokens += outputTokens
      }
    }
    return next
  })
  return { ...state, timedStep: { turn, step }, series, llmMs: state.llmMs + llmMs }
}

/** Fold one committed event; uninteresting events return the same state reference. */
function applyEvent(state, event) {
  const data = event.data
  switch (event.type) {
    case 'turn/start':
      return {
        ...state,
        series: [...state.series, emptyTurn(data.turn, event.time)],
        turns: state.turns + 1,
        firstTime: state.firstTime ?? event.time,
        lastTime: event.time,
      }
    case 'step/start':
      return {
        ...state,
        openStep: { turn: data.turn, step: data.step, startTime: event.time, firstTokenTime: null },
      }
    case 'assistant/attempt': {
      const open = state.openStep
      let next = state
      if (open !== null && open.turn === data.turn && open.step === data.step && open.firstTokenTime === null) {
        const first = firstTokenTimeOf(data.stream)
        if (first !== null) next = { ...next, openStep: { ...open, firstTokenTime: first } }
      }
      const chunk = lastUsageChunk(data.stream)
      if (chunk === undefined) return next
      const buckets = bucketsOf(chunk.usage)
      if (buckets === null) return next
      return settleSample(next, data.turn, data.step, buckets, null)
    }
    case 'llm/retry-started':
      // Close the replacement slot so the retried attempt bills on top.
      return state.slot !== null && state.slot.turn === data.turn && state.slot.step === data.step
        ? { ...state, slot: null }
        : state
    case 'assistant/message': {
      const open = state.openStep
      const matches = open !== null && open.turn === data.turn && open.step === data.step
      const stream = Array.isArray(data.stream) ? data.stream : []
      const firstToken = matches
        ? open.firstTokenTime ?? firstTokenTimeOf(stream)
        : null
      const usageRecord = data.usage ?? lastUsageChunk(stream)?.usage
      const buckets = bucketsOf(usageRecord)
      let next = state
      if (buckets !== null) next = settleSample(next, data.turn, data.step, buckets, routeOf(data.message))
      if (matches) {
        next = bookTiming(
          next,
          data.turn,
          data.step,
          Math.max(0, event.time - open.startTime),
          firstToken === null ? null : Math.max(0, firstToken - open.startTime),
          firstToken === null ? null : Math.max(0, event.time - firstToken),
          buckets?.output ?? 0,
        )
      }
      return { ...next, openStep: null, lastTime: event.time }
    }
    case 'step/end': {
      const cleared = state.openStep === null ? state : { ...state, openStep: null }
      const series = cleared.series.map((row) =>
        row.turn === data.turn ? { ...row, steps: row.steps + 1 } : row)
      return { ...cleared, series, steps: cleared.steps + 1 }
    }
    case 'tool/call': {
      const callId = data.callId
      if (typeof callId !== 'string' || callId === '') return state
      return { ...state, pendingCalls: { ...state.pendingCalls, [callId]: event.time } }
    }
    case 'tool/result': {
      const callId = data.message?.source?.callId
      if (typeof callId !== 'string' || !Object.hasOwn(state.pendingCalls, callId)) return state
      const elapsed = Math.max(0, event.time - state.pendingCalls[callId])
      const pendingCalls = { ...state.pendingCalls }
      delete pendingCalls[callId]
      const turn = typeof data.turn === 'number' ? data.turn : null
      const series = turn === null
        ? state.series
        : state.series.map((row) => (row.turn === turn ? { ...row, toolMs: row.toolMs + elapsed } : row))
      return { ...state, pendingCalls, series, toolMs: state.toolMs + elapsed, lastTime: event.time }
    }
    case 'turn/end': {
      const series = state.series.map((row) =>
        row.turn === data.turn && !row.closed ? { ...row, closed: true, endTime: event.time } : row)
      const dirty = Object.keys(state.pendingCalls).length > 0 || state.slot !== null
      return {
        ...state,
        series,
        lastTime: event.time,
        pendingCalls: dirty ? {} : state.pendingCalls,
        slot: null,
      }
    }
    default:
      return state
  }
}

/** Compose the published client view; cached per state reference so unchanged state costs nothing. */
function buildView(state) {
  const models = Object.values(state.models).sort(
    (left, right) =>
      (right.input + right.cacheRead + right.cacheWrite + right.output)
      - (left.input + left.cacheRead + left.cacheWrite + left.output),
  )
  return {
    totals: {
      turns: state.turns,
      steps: state.steps,
      llmMs: state.llmMs,
      toolMs: state.toolMs,
      firstTime: state.firstTime,
      lastTime: state.lastTime,
    },
    models,
    series: state.series,
  }
}

const viewCache = new WeakMap()

function view(state) {
  const cached = viewCache.get(state)
  if (cached !== undefined) return cached
  const built = buildView(state)
  viewCache.set(state, built)
  return built
}

const definition = {
  key: 'tokenPulse',
  stateVersion: 2,
  stateSchema: passthrough,
  init: (_header, _inheritedEventCount) => ({
    series: [],
    models: {},
    slot: null,
    openStep: null,
    timedStep: null,
    pendingCalls: {},
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    firstTime: null,
    lastTime: null,
  }),
  apply: applyEvent,
  wire: { viewSchema: passthrough, view, summary: false },
}

export async function apply(ctx) {
  // Registration belongs to this fiber; unloading the bundle removes the unit with it.
  await ctx.sessionProjections.register(definition)
}
