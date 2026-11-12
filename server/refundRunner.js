import { clientFor } from './state.js'
import { usd } from './money.js'
import { PayPalError, isTransient } from './paypal/errors.js'

// An error after which the refund may or may not have reached PayPal (lost answer, 5xx, unknown error).
// A definite 4xx means PayPal refused, so nothing moved.
const mayHaveLanded = (err) => !(err instanceof PayPalError) || isTransient(err)

function record(state, { path, id, status, cents, txnId, backend, recovered = false }) {
  return {
    path: path === 'v1sale' ? 'v1 sale refund' : 'v2 capture refund',
    refundPath: path,
    backend,
    id,
    status,
    recovered,
    amountCents: cents,
    amountLabel: usd(cents),
    txnId,
    at: new Date(state.clock.now()).toISOString(),
  }
}

// Runs ONE refund on the path fixed in config (REFUND_PATH). It never switches paths by itself:
// a second path could refund the same money twice. Idempotent per subscription + transaction:
//  - a finished refund is returned from the ledger;
//  - every request carries the same PayPal-Request-Id (v1 REST header, v2 toolkit context.request_id);
//  - after an attempt whose answer may have been lost, the v2 path first re-reads the capture's
//    refunded total and does not send again if the money already left.
export async function runRefund(state, sub, { txnId, cents }) {
  const key = `${sub.id}:${txnId}`
  const done = state.refundCache.get(key)
  if (done) return done
  const pp = clientFor(state, sub)
  const path = state.config.refundPath
  const requestId = `refund-${sub.id}-${txnId}`
  const attempt = state.refundAttempts.get(key) || { tries: 0, uncertain: false }
  const backend = pp.backend

  if (path !== 'v1sale' && attempt.uncertain) {
    const known = [...state.refundCache.values()].filter((r) => r.txnId === txnId).reduce((sum, r) => sum + r.amountCents, 0)
    const seen = (await pp.getCaptureRefunded(txnId)).data.refundedCents
    if (seen - known >= cents) {
      const recovered = record(state, { path, id: null, status: 'COMPLETED', cents, txnId, backend, recovered: true })
      state.refundCache.set(key, recovered)
      return recovered
    }
  }

  let out
  try {
    out = path === 'v1sale'
      ? await pp.refundSale(txnId, { amountCents: cents, requestId })
      : await pp.refundCapture(txnId, { amountCents: cents, requestId, note: `Unused days refund, ${state.config.merchantName}` })
  } catch (err) {
    state.refundAttempts.set(key, { tries: attempt.tries + 1, uncertain: attempt.uncertain || mayHaveLanded(err) })
    throw err
  }
  const status = String(out.data.status || out.data.state || 'COMPLETED').toUpperCase()
  const refund = record(state, { path, id: out.data.id, status, cents, txnId, backend })
  state.refundCache.set(key, refund)
  return refund
}
