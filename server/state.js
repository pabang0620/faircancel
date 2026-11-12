import { createKeyedLock } from './lock.js'
import { createActivityLog, instrument } from './paypal/gateway.js'
import { HttpError } from './http.js'

// Shared in-memory state plus small helpers every service module uses.
export function createState({ clock = { now: () => Date.now() }, local, sandbox = null, policyStore, config }) {
  const activity = createActivityLog(clock)
  return {
    clock,
    config,
    policyStore,
    activity,
    withLock: createKeyedLock(),
    subs: new Map(),
    sessions: new Map(),
    clients: { local, sandbox },
    refundCache: new Map(),
    refundAttempts: new Map(),
    ipLimits: new Map(),
  }
}

export const iso = (state, ms = state.clock.now()) => new Date(ms).toISOString()

export function clientFor(state, sub) {
  const raw = sub.backend === 'sandbox' ? state.clients.sandbox : state.clients.local
  return instrument(raw, state.activity, sub.id)
}

export function ensureSession(state, sessionId) {
  if (!state.sessions.has(sessionId)) state.sessions.set(sessionId, { id: sessionId, subIds: [], createdAt: iso(state) })
  return state.sessions.get(sessionId)
}

// Subscriptions belong to the session that claimed them. Another session gets 404, not 403,
// so subscription IDs cannot be probed.
export function ownedSub(state, sessionId, subId) {
  const sub = state.subs.get(subId)
  if (!sub || sub.sessionId !== sessionId) throw new HttpError(404, 'Subscription not found for this session.')
  return sub
}

const HOUR_MS = 3_600_000

// Per-IP hourly counter on the injected clock. Returns false (and counts nothing) once the limit is used up.
export function takeIpSlot(state, ip, kind, limit) {
  if (!ip || !(limit > 0)) return true
  const key = `${kind}:${ip}`
  const now = state.clock.now()
  const recent = (state.ipLimits.get(key) || []).filter((t) => now - t < HOUR_MS)
  if (recent.length >= limit) { state.ipLimits.set(key, recent); return false }
  state.ipLimits.set(key, [...recent, now])
  return true
}
