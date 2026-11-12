import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { clientFor, ensureSession, iso, takeIpSlot } from './state.js'
import { isTransient } from './paypal/errors.js'
import { HttpError } from './http.js'
import { DAY_MS } from './refundCalc.js'

// Scenario -> merchant usage record for the current paid week (plan 7-5).
export const SCENARIOS = {
  1: { key: 'pause', title: 'Pause', usage: 1 },
  2: { key: 'cancel', title: 'Cancel', usage: 1 },
  3: { key: 'full_refund', title: 'Full refund', usage: 0 },
  4: { key: 'resume', title: 'Resume a paused one', usage: 1, startsPaused: true },
}

export function createSeedFile(file) {
  const read = () => {
    if (!file || !existsSync(file)) return []
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return [] }
  }
  const write = (seeds) => {
    if (!file) return
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(seeds, null, 2))
  }
  return { read, write }
}

export function poolStatus(state, seedFile) {
  const sandbox = !!state.clients.sandbox
  const ready = sandbox ? seedFile.read().filter((s) => !s.claimedBy && !s.bad).length : null
  return { mode: sandbox ? 'sandbox' : 'local', ready, banner: sandbox ? null : 'local mode, no PayPal calls' }
}

function subRecord(state, { id, backend, sessionId, scenario, details }) {
  return {
    id, backend, sessionId, scenario,
    status: 'ACTIVE',
    usageCount: SCENARIOS[scenario].usage,
    subscriberName: [details?.subscriber?.name?.given_name, details?.subscriber?.name?.surname].filter(Boolean).join(' ') || 'Sandbox subscriber',
    offer: null, offerRequested: false, reason: null,
    resumeAt: null, pauseResult: null, pendingCancel: null, result: null, refund: null, refundError: null,
    refundedCents: 0, quoteCache: null, lastDetails: details || null, claimedAt: iso(state),
  }
}

async function validateSandboxSeed(pp, id) {
  const details = (await pp.showSubscription(id)).data
  const txns = (await pp.listTransactions(id)).data.transactions || []
  // Only a status that can never come back to ACTIVE is permanent. An ACTIVE seed whose first payment
  // has not completed yet is "not ready", not "bad".
  const permanent = details.status !== 'ACTIVE'
  const ok = !permanent && txns.some((t) => t.status === 'COMPLETED')
  return { ok, permanent, details }
}

// Startup scan: a seed whose subscription can never come back to ACTIVE (cancelled, expired) is marked bad,
// so the "N ready" count is not inflated. A network blip or a first payment still pending is left alone (F13).
export async function scanSeeds(state, seedFile) {
  if (!state.clients.sandbox) return { checked: 0, bad: 0 }
  return state.withLock('seed-pool', async () => {
    const seeds = seedFile.read()
    let checked = 0
    let bad = 0
    for (const seed of seeds.filter((x) => !x.claimedBy && !x.bad)) {
      try {
        const check = await validateSandboxSeed(clientFor(state, { id: seed.subscriptionId, backend: 'sandbox' }), seed.subscriptionId)
        checked += 1
        if (check.permanent) { seed.bad = true; bad += 1 }
        else seed.checkedAt = iso(state)
      } catch (err) {
        if (!isTransient(err)) { seed.bad = true; bad += 1 }
      }
    }
    seedFile.write(seeds)
    return { checked, bad }
  })
}

// Hands one subscription to one session. A seed is claimed exactly once (judge_seed_claimed_once).
export async function claimSeed(state, seedFile, { sessionId, scenario, allowLocal = false, ip = null }) {
  if (!SCENARIOS[scenario]) throw new HttpError(400, 'Unknown scenario.')
  if (!state.sessions.has(sessionId) && !takeIpSlot(state, ip, 'session', state.config.newSessionsPerIpHour ?? 10)) {
    throw new HttpError(429, 'Too many new sessions from this network. Try again in an hour, or reset your current session.', 'session_limit')
  }
  const session = ensureSession(state, sessionId)
  // Only an untouched subscription is handed back: once a reason was sent, the same button gives a new one,
  // so a judge can try another sentence without Start over (REVIEW_3 F1).
  const untouched = (s) => !s.reason && !s.offer && !s.offerRequested && !s.pendingCancel && !s.result && !s.refund
  const reusable = (s) => s.scenario === scenario && untouched(s) && (SCENARIOS[scenario].startsPaused ? s.status === 'SUSPENDED' : s.status === 'ACTIVE')
  const existing = session.subIds.map((id) => state.subs.get(id)).find(reusable)
  if (existing) return existing
  if (session.subIds.length >= state.config.maxSeedsPerSession) throw new HttpError(429, 'This session already holds the maximum number of subscriptions. Press Start over to begin again.')

  return state.withLock('seed-pool', async () => {
    let sub = null
    if (state.clients.sandbox) {
      const seeds = seedFile.read()
      let unreachable = false
      for (const seed of seeds.filter((s) => !s.claimedBy && !s.bad)) {
        const pp = clientFor(state, { id: seed.subscriptionId, backend: 'sandbox' })
        try {
          const check = await validateSandboxSeed(pp, seed.subscriptionId)
          if (!check.ok) { if (check.permanent) seed.bad = true; continue }
          if (!takeIpSlot(state, ip, 'seed', state.config.seedsPerIpHour ?? 12)) {
            throw new HttpError(429, 'Too many sandbox subscriptions taken from this network this hour. Continue in local mode or try later.', 'seed_limit')
          }
          seed.claimedBy = sessionId
          seed.claimedAt = iso(state)
          sub = subRecord(state, { id: seed.subscriptionId, backend: 'sandbox', sessionId, scenario, details: check.details })
          break
        } catch (err) {
          if (err instanceof HttpError) { seedFile.write(seeds); throw err }
          if (isTransient(err)) unreachable = true
          else seed.bad = true
        }
      }
      seedFile.write(seeds)
      if (!sub && !allowLocal) {
        if (unreachable) throw new HttpError(503, 'PayPal is not reachable right now. Try again in a minute.', 'paypal_unreachable')
        throw new HttpError(409, 'All sandbox subscriptions are in use. Continue in local mode.', 'pool_empty')
      }
    }
    if (!sub) {
      const id = state.clients.local.seedSubscription({ paidAt: state.clock.now() - DAY_MS })
      sub = subRecord(state, { id, backend: 'local', sessionId, scenario, details: (await state.clients.local.showSubscription(id)).data })
    }
    state.subs.set(sub.id, sub)
    session.subIds = [...session.subIds, sub.id]
    if (SCENARIOS[scenario].startsPaused) {
      await clientFor(state, sub).suspend(sub.id, 'Paused before the demo (seed setup)')
      sub.status = 'SUSPENDED'
      sub.resumeAt = state.clock.now() + 4 * 7 * DAY_MS
      sub.pauseResult = { pausedAt: iso(state), weeks: 4, resumeAt: iso(state, sub.resumeAt) }
    }
    return sub
  })
}

// Lets a judge start over. Their subscriptions leave the session; a sandbox seed that was never touched
// (still ACTIVE, no offer, no pause, no refund) goes back to the pool, any other seed stays used.
export async function resetSession(state, seedFile, sessionId) {
  const session = state.sessions.get(sessionId)
  if (!session) return { removed: 0, released: 0 }
  return state.withLock('seed-pool', async () => {
    const subs = session.subIds.map((id) => state.subs.get(id)).filter(Boolean)
    const untouched = (s) => s.backend === 'sandbox' && s.status === 'ACTIVE' && !s.offer && !s.offerRequested && !s.pendingCancel && !s.pauseResult && !s.refund && !s.result && s.scenario !== 4
    const release = new Set(subs.filter(untouched).map((s) => s.id))
    if (release.size) {
      const seeds = seedFile.read()
      seedFile.write(seeds.map((seed) => (release.has(seed.subscriptionId) ? { ...seed, claimedBy: null, claimedAt: null } : seed)))
    }
    for (const s of subs) state.subs.delete(s.id)
    state.sessions.set(sessionId, { ...session, subIds: [] })
    return { removed: subs.length, released: release.size }
  })
}
