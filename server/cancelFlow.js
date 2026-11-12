import { clientFor, iso } from './state.js'
import { HttpError } from './http.js'
import { quoteRefund, DAY_MS } from './refundCalc.js'
import { runRefund } from './refundRunner.js'
import { isTransient, isStatusInvalid } from './paypal/errors.js'
import { usd } from './money.js'

const QUOTE_TTL_MS = 10_000
const DEFAULT_REFUND_TRIES = 3

function publicQuote(q) {
  return {
    cents: q.cents,
    amount: usd(q.cents),
    reason: q.reason,
    formula: q.formula || null,
    message: q.message || null,
    held: !!q.held,
    paidAt: q.paidAt || null,
    periodEnd: q.periodEnd || null,
    at: q.now,
    reconcileMismatch: !!q.reconcile?.mismatch,
  }
}

// Server-side refund quote for "If you cancel now". Recomputed from PayPal transactions each time
// (cached a few seconds unless fresh=true) so the number on screen is never a model's number.
export async function liveQuote(state, sub, { fresh = false, at = state.clock.now() } = {}) {
  const cached = sub.quoteCache
  if (!fresh && cached && at - cached.at < QUOTE_TTL_MS) return cached.quote
  const pp = clientFor(state, sub)
  const txns = (await pp.listTransactions(sub.id)).data.transactions || []
  const info = sub.lastDetails?.billing_info?.last_payment?.time
  const q = quoteRefund({ transactions: txns, usageCount: sub.usageCount, now: at, policy: state.policyStore.get().merchant, billingInfoTime: info, refundedCents: sub.refundedCents })
  const quote = { ...q, public: publicQuote(q) }
  sub.quoteCache = { at, quote }
  return quote
}

export async function pause(state, sub) {
  return state.withLock(sub.id, async () => {
    if (sub.status === 'CANCELLED' || sub.pendingCancel) throw new HttpError(409, 'This subscription is already being cancelled.', 'cancel_won')
    if (sub.status !== 'ACTIVE') throw new HttpError(409, 'This subscription is not active, so it cannot be paused.')
    const offer = sub.offer
    const menu = state.policyStore.get().merchant.pauseMenuWeeks
    if (!offer || offer.shown.type !== 'pause' || offer.consumed || !menu.includes(offer.shown.weeks)) throw new HttpError(409, 'There is no pause offer to accept.')
    const weeks = offer.shown.weeks
    await clientFor(state, sub).suspend(sub.id, `Subscriber-requested pause for ${weeks} weeks (FairCancel)`)
    const now = state.clock.now()
    sub.status = 'SUSPENDED'
    sub.resumeAt = now + weeks * 7 * DAY_MS
    sub.offer = { ...offer, consumed: true }
    sub.pauseResult = { pausedAt: iso(state, now), weeks, resumeAt: iso(state, sub.resumeAt) }
    return sub.pauseResult
  })
}

export async function resume(state, sub, by = 'subscriber') {
  return state.withLock(sub.id, async () => {
    if (sub.status !== 'SUSPENDED') throw new HttpError(409, 'This subscription is not paused.')
    await clientFor(state, sub).activate(sub.id, by === 'scheduler' ? 'Pause ended (scheduled by FairCancel)' : 'Subscriber resumed')
    sub.status = 'ACTIVE'
    sub.resumeAt = null
    sub.pauseResult = null
    sub.quoteCache = null
    return { resumedAt: iso(state), by }
  })
}

async function cancelOnPayPal(state, sub) {
  const pp = clientFor(state, sub)
  const reason = (sub.pendingCancel.reason || 'Subscriber chose Cancel now').slice(0, 128)
  try {
    await pp.cancel(sub.id, reason)
  } catch (err) {
    // S5 fallback: if PayPal refuses to cancel a SUSPENDED subscription, activate it first.
    if (sub.status === 'SUSPENDED' && isStatusInvalid(err)) {
      await pp.activate(sub.id, 'Reactivated to complete cancellation')
      await pp.cancel(sub.id, reason)
    } else throw err
  }
  sub.status = 'CANCELLED'
  sub.cancelledAt = iso(state)
  sub.resumeAt = null
}

// Runs the cancel phases in order and can be called again after any stop: PayPal cancel, quote, refund.
// A transient stop keeps pendingCancel so the timer tries again. Any other failure ends the request
// (pendingCancel cleared) so nothing retries forever; the subscriber or merchant sees the end state.
async function finishCancel(state, sub) {
  try {
    return await runCancelPhases(state, sub)
  } catch (err) {
    if (!isTransient(err)) sub.pendingCancel = null
    throw err
  }
}

async function runCancelPhases(state, sub) {
  const req = sub.pendingCancel
  req.attempts += 1
  if (sub.status !== 'CANCELLED') {
    try { await cancelOnPayPal(state, sub) } catch (err) {
      if (isTransient(err)) { req.lastError = String(err.message).slice(0, 160); return queued(state, sub) }
      throw err
    }
  }
  if (!req.quote) {
    try { req.quote = await liveQuote(state, sub, { fresh: true, at: req.requestedAt }) } catch (err) {
      if (isTransient(err)) return queued(state, sub)
      return refundGaveUp(state, sub, { cents: 0, reason: 'unavailable', now: state.clock.now() }, String(err.issue || err.message))
    }
  }
  const quote = req.quote
  if (quote.held) { req.phase = 'refund_waiting'; req.quote = null; return assemble(state, sub, quote, null, 'refund_waiting') }
  let refund = sub.refund || null
  if (!refund && quote.cents > 0) {
    try {
      refund = await runRefund(state, sub, { txnId: quote.payment.id, cents: quote.cents })
      sub.refund = refund
      sub.refundedCents += refund.amountCents
    } catch (err) {
      if (!isTransient(err)) return refundGaveUp(state, sub, quote, String(err.issue || err.message))
      req.refundTries = (req.refundTries || 0) + 1
      req.lastError = String(err.message).slice(0, 160)
      const limit = state.config.refundMaxTries ?? DEFAULT_REFUND_TRIES
      if (req.refundTries >= limit) return refundGaveUp(state, sub, quote, `PayPal did not answer after ${req.refundTries} tries`)
      return queued(state, sub)
    }
  }
  sub.pendingCancel = null
  return assemble(state, sub, quote, refund, 'done')
}

// Terminal state: the cancel is done, the refund is not. The request is closed, the timer stops,
// and the merchant panel shows "refund by hand". Nothing sends the refund again on its own.
function refundGaveUp(state, sub, quote, why) {
  sub.refundError = why.slice(0, 160)
  sub.pendingCancel = null
  return assemble(state, sub, quote, null, 'refund_failed')
}

function queued(state, sub) {
  const cancelled = sub.status === 'CANCELLED'
  const at = iso(state, sub.pendingCancel.requestedAt).slice(11, 16)
  sub.result = {
    kind: 'queued',
    requestedAt: iso(state, sub.pendingCancel.requestedAt),
    message: cancelled
      ? `Your subscription is cancelled. We couldn't reach PayPal to send your refund. It is saved (${at} UTC) and will be sent again.`
      : `We couldn't reach PayPal. Your cancel request is saved at ${at} UTC and will be sent again.`,
  }
  return sub.result
}

function assemble(state, sub, quote, refund, phase) {
  sub.result = {
    kind: 'cancelled',
    phase,
    cancelledAt: sub.cancelledAt,
    requestedAt: iso(state, sub.requestedAtMs ?? state.clock.now()),
    quote: publicQuote(quote),
    refund,
    refundError: sub.refundError || null,
    policy: { by: state.config.merchantName, setAt: state.policyStore.get().setAt },
    message: phase === 'refund_waiting' ? quote.message : null,
  }
  return sub.result
}

export async function cancel(state, sub, reason) {
  return state.withLock(sub.id, async () => {
    if (sub.result?.kind === 'cancelled' && (sub.result.phase === 'done' || sub.result.phase === 'refund_failed')) return sub.result
    if (!sub.pendingCancel) {
      sub.requestedAtMs = state.clock.now()
      sub.pendingCancel = { requestedAt: sub.requestedAtMs, reason: reason || '', attempts: 0, phase: 'cancel' }
    }
    return finishCancel(state, sub)
  })
}

// Called on a timer: retries cancels PayPal could not take, refunds waiting on a pending payment,
// and scheduled resumes. Every step goes through the same locked, idempotent paths.
export async function runDueWork(state) {
  const now = state.clock.now()
  const out = { retried: 0, resumed: 0 }
  for (const sub of [...state.subs.values()]) {
    if (sub.pendingCancel) {
      await state.withLock(sub.id, async () => { if (sub.pendingCancel) { await finishCancel(state, sub).catch(() => null); out.retried += 1 } })
    } else if (sub.status === 'SUSPENDED' && sub.resumeAt && sub.resumeAt <= now) {
      await resume(state, sub, 'scheduler').then(() => { out.resumed += 1 }).catch(() => null)
    }
  }
  return out
}

// Reads PayPal's current state; webhook payloads only trigger this, they are never trusted.
export async function sync(state, sub) {
  return state.withLock(sub.id, async () => {
    const details = (await clientFor(state, sub).showSubscription(sub.id)).data
    sub.lastDetails = details
    sub.lastSyncAt = iso(state)
    if (details.status && details.status !== sub.status && ['ACTIVE', 'SUSPENDED', 'CANCELLED'].includes(details.status)) {
      sub.status = details.status
      if (details.status === 'CANCELLED') { sub.cancelledAt = sub.cancelledAt || iso(state); sub.resumeAt = null }
      if (details.status !== 'SUSPENDED') sub.resumeAt = null
      sub.quoteCache = null
    }
    sub.lastSync = { status: sub.status, paypalStatus: details.status || null, nextBillingTime: details.billing_info?.next_billing_time || null, syncedAt: sub.lastSyncAt }
    return sub.lastSync
  })
}
