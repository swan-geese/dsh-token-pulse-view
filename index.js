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

import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

export const inject = ['sessionProjections', 'webServer', 'connection']

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
      const firstOut = matches
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
          firstOut === null ? null : Math.max(0, firstOut - open.startTime),
          firstOut === null ? null : Math.max(0, event.time - firstOut),
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

/* ------------------------------------------------------------------ *
 * Cross-session statistics: a read-only JSON route over the durable  *
 * session archive. Same billing rule as the projection fold — every  *
 * `assistant/message` / `assistant/attempt` usage record is one      *
 * billed request — aggregated per LOCAL calendar day and per model.  *
 * Nothing is written. The scan is cached (30 s) and capped by a      *
 * wall-time budget, so a huge archive degrades to `partial: true`    *
 * instead of hanging the route.                                      *
 * ------------------------------------------------------------------ */

/** Zstandard frame magic (little-endian). */
const ZSTD_FRAME = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const CACHE_TTL_MS = 30_000
const SCAN_BUDGET_MS = 4_000

/**
 * The sessions root, mirroring dsh-base's `dshHomePath('sessions')`:
 * `$DSH_HOME` (when non-blank) else `~/.dsh`, joined with `sessions`.
 */
function sessionsRoot() {
  const env = (process.env.DSH_HOME ?? '').trim()
  return resolve(join(env !== '' ? env : join(homedir(), '.dsh'), 'sessions'))
}

/** Decompress one multi-frame zstd session log into text. */
function decodeLog(buf) {
  const starts = []
  for (let i = buf.indexOf(ZSTD_FRAME); i !== -1; i = buf.indexOf(ZSTD_FRAME, i + 4)) starts.push(i)
  let text = ''
  for (let k = 0; k < starts.length; k += 1) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length
    try {
      text += zstdDecompressSync(buf.subarray(starts[k], end)).toString('utf8')
    } catch {
      // A damaged frame costs its lines only; the rest still aggregate.
    }
  }
  return text
}

/** Local calendar day key for one timestamp (matches the browser rendering). */
function dayKey(time) {
  const d = new Date(time)
  const pad = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function emptyBucket() {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
}

function addUsage(bucket, usage) {
  bucket.requests += 1
  bucket.input += usage.inputTokens
  bucket.output += usage.outputTokens
  bucket.cacheRead += usage.cacheReadTokens ?? 0
  bucket.cacheWrite += usage.cacheWriteTokens ?? 0
  bucket.reasoning += usage.reasoningTokens ?? 0
}

/** Recursively collect v4 session logs under a directory. */
function collectLogs(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectLogs(full, out)
    else if (entry.name === 'session.v4.jsonl.zstd') out.push(full)
  }
  return out
}

/**
 * Aggregate every billed usage record in the session archive.
 * @param root - the sessions directory.
 * @param budgetMs - wall-time cap; the scan stops early and flags partial.
 * @returns plain-JSON { days, models, sessions, scanned, partial }.
 */
function aggregateArchive(root, budgetMs) {
  const deadline = Date.now() + budgetMs
  const logs = collectLogs(root, [])
  const days = new Map()
  const models = new Map()
  const sessions = []
  let partial = false
  for (const file of logs) {
    if (Date.now() > deadline) { partial = true; break }
    let buf
    try { buf = readFileSync(file) } catch { continue }
    if (buf.length === 0) continue
    const text = decodeLog(buf)
    const lines = text.split('\n')
    let meta = null
    try { meta = JSON.parse(lines[0] ?? '') } catch { /* header best-effort */ }
    const session = {
      id: typeof meta?.id === 'string' ? meta.id : file.split('/').slice(-2)[0],
      cwd: typeof meta?.cwd === 'string' ? meta.cwd : '',
      createdAt: typeof meta?.createdAt === 'number' ? meta.createdAt : 0,
      requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
      models: new Set(),
    }
    let billed = false
    for (const line of lines) {
      if (!line.includes('"usage"')) continue
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
      const usage = event.data?.usage
      if (typeof usage?.inputTokens !== 'number' || typeof usage?.outputTokens !== 'number') continue
      billed = true
      const dk = dayKey(event.time ?? Date.now())
      const day = days.get(dk) ?? emptyBucket()
      addUsage(day, usage)
      days.set(dk, day)
      const source = event.data?.message?.source
      const key = typeof source?.provider === 'string' && typeof source?.model === 'string'
        ? `${source.provider}/${source.model}`
        : 'unknown'
      const model = models.get(key) ?? emptyBucket()
      addUsage(model, usage)
      models.set(key, model)
      session.requests += 1
      session.input += usage.inputTokens
      session.output += usage.outputTokens
      session.cacheRead += usage.cacheReadTokens ?? 0
      session.cacheWrite += usage.cacheWriteTokens ?? 0
      session.models.add(key)
    }
    if (billed) sessions.push({ ...session, models: [...session.models] })
  }
  const dayRows = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, bucket]) => ({ day, ...bucket }))
  const modelRows = [...models.entries()].sort((a, b) =>
    (b[1].input + b[1].cacheRead + b[1].cacheWrite + b[1].output)
    - (a[1].input + a[1].cacheRead + a[1].cacheWrite + a[1].output))
    .map(([model, bucket]) => ({ model, ...bucket }))
  return { days: dayRows, models: modelRows, sessions, scanned: logs.length, partial }
}

/** Register GET /token-pulse/stats, fenced exactly like the host's own routes. */
function registerStatsRoute(ctx) {
  if (typeof ctx.webServer?.register !== 'function') return
  let cache = null
  let cachedAt = 0
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/token-pulse/stats',
    handler: async (req, res) => {
      const send = (code, body) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(body))
      }
      if (ctx.connection?.requestRejection?.(req) !== undefined) {
        send(403, { ok: false, error: 'forbidden' })
        return
      }
      if (req.method !== 'GET') {
        send(405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        if (cache === null || Date.now() - cachedAt > CACHE_TTL_MS) {
          cache = aggregateArchive(sessionsRoot(), SCAN_BUDGET_MS)
          cachedAt = Date.now()
        }
        const url = new URL(req.url ?? '', 'http://local')
        const days = Math.min(3660, Math.max(1, Number(url.searchParams.get('days')) || 3660))
        const cutoff = new Date()
        cutoff.setHours(0, 0, 0, 0)
        cutoff.setDate(cutoff.getDate() - (days - 1))
        const pad = (v) => String(v).padStart(2, '0')
        const cutoffKey = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`
        const window = cache.days.filter((row) => row.day >= cutoffKey)
        const total = window.reduce((acc, row) => {
          acc.requests += row.requests
          acc.input += row.input
          acc.output += row.output
          acc.cacheRead += row.cacheRead
          acc.cacheWrite += row.cacheWrite
          acc.reasoning += row.reasoning
          return acc
        }, emptyBucket())
        send(200, {
          ok: true,
          generatedAt: cachedAt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          days,
          partial: cache.partial,
          scanned: cache.scanned,
          sessions: cache.sessions.length,
          window: { total, days: window },
          models: cache.models,
          top: cache.sessions.slice().sort((a, b) =>
            (b.input + b.cacheRead + b.cacheWrite + b.output) - (a.input + a.cacheRead + a.cacheWrite + a.output))
            .slice(0, 10),
        })
      } catch (error) {
        send(500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }), 'token-pulse: cross-session stats route')
}

export async function apply(ctx) {
  // Registration belongs to this fiber; unloading the bundle removes both with it.
  await ctx.sessionProjections.register(definition)
  registerStatsRoute(ctx)
}
