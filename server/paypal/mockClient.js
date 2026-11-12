import { randomBytes } from 'node:crypto'
import { PayPalError } from './errors.js'
import { DAY_MS } from '../refundCalc.js'

// Local stand-in for PayPal Subscriptions. Response shapes follow the public schemas:
// subscription (GET /v1/billing/subscriptions/{id}), subscription_transaction_details,
// refund (POST /v2/payments/captures/{id}/refund) and the v1 sale refund.
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const rid = (length) => Array.from(randomBytes(length), (b) => ALNUM[b % ALNUM.length]).join('')
const publicRefund = ({ txnId, ...refund }) => refund
const money = (cents) => ({ currency_code: 'USD', value: (cents / 100).toFixed(2) })

export function createMockPaypal({ clock = { now: () => Date.now() }, v2RefundWorks = true, suspendedCancelWorks = true } = {}) {
  const subs = new Map()
  const txns = new Map()
  const refunds = new Map()
  const requestIds = new Map()

  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const call = (method, path) => ({ method, path, via: 'mock' })
  const fail = (status, name, issue, c) => { throw new PayPalError(status, name, issue, c) }
  const need = (id, c) => subs.get(id) || fail(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', c)

  function view(sub) {
    const list = txns.get(sub.id) || []
    const last = [...list].filter((t) => t.status === 'COMPLETED' || t.status === 'PARTIALLY_REFUNDED').pop()
    return {
      id: sub.id,
      plan_id: sub.planId,
      start_time: iso(sub.createdAt),
      quantity: '1',
      status: sub.status,
      status_update_time: iso(sub.statusUpdatedAt),
      subscriber: sub.subscriber,
      billing_info: {
        outstanding_balance: money(0),
        cycle_executions: [{ tenure_type: 'REGULAR', sequence: 1, cycles_completed: list.length, cycles_remaining: 0, total_cycles: 0 }],
        last_payment: last ? { amount: last.amount_with_breakdown.gross_amount, time: last.time } : undefined,
        next_billing_time: sub.status === 'ACTIVE' && last ? iso(Date.parse(last.time) + 7 * DAY_MS) : undefined,
        failed_payments_count: 0,
      },
      create_time: iso(sub.createdAt),
      update_time: iso(sub.statusUpdatedAt),
    }
  }

  function setStatus(sub, status) {
    sub.status = status
    sub.statusUpdatedAt = clock.now()
  }

  return {
    backend: 'local',
    // ---- test and seed helpers (not part of the PayPal surface) ----
    seedSubscription({ paidAt, amountCents = 900, planId = 'P-FAIRCANCEL-WEEKLY', given = 'Jamie', surname = 'Rivera', status = 'ACTIVE', txnStatus = 'COMPLETED' }) {
      const id = `I-MOCK${rid(8)}`
      const sub = { id, planId, status, createdAt: paidAt, statusUpdatedAt: paidAt, subscriber: { name: { given_name: given, surname }, email_address: `${given.toLowerCase()}@example.invalid` } }
      subs.set(id, sub)
      txns.set(id, [{ status: txnStatus, id: `MOCK-TXN-${rid(8)}`, amount_with_breakdown: { gross_amount: money(amountCents), fee_amount: money(Math.round(amountCents * 0.029) + 30), net_amount: money(amountCents - Math.round(amountCents * 0.029) - 30) }, payer_name: { given_name: given, surname }, payer_email: sub.subscriber.email_address, time: iso(paidAt) }])
      return id
    },
    addPayment(id, { paidAt, amountCents = 900, status = 'COMPLETED' }) {
      txns.set(id, [...(txns.get(id) || []), { status, id: `MOCK-TXN-${rid(8)}`, amount_with_breakdown: { gross_amount: money(amountCents) }, time: iso(paidAt) }])
    },
    buyerCancelsAtPayPal(id) { setStatus(need(id, call('POST', 'buyer')), 'CANCELLED') },
    // ---- the PayPal surface ----
    async showSubscription(id) {
      const c = call('GET', `/v1/billing/subscriptions/${id}`)
      return { status: 200, data: view(need(id, c)), call: c }
    },
    async listTransactions(id) {
      const c = call('GET', `/v1/billing/subscriptions/${id}/transactions`)
      need(id, c)
      const list = txns.get(id) || []
      return { status: 200, data: { transactions: list, total_items: list.length, total_pages: 1 }, call: c }
    },
    async suspend(id, reason) {
      const c = call('POST', `/v1/billing/subscriptions/${id}/suspend`)
      const sub = need(id, c)
      if (!reason) fail(400, 'INVALID_REQUEST', 'MISSING_REQUIRED_PARAMETER', c)
      if (sub.status !== 'ACTIVE') fail(422, 'UNPROCESSABLE_ENTITY', 'SUBSCRIPTION_STATUS_INVALID', c)
      setStatus(sub, 'SUSPENDED')
      return { status: 204, data: {}, call: c }
    },
    async activate(id, reason) {
      const c = call('POST', `/v1/billing/subscriptions/${id}/activate`)
      const sub = need(id, c)
      if (!reason) fail(400, 'INVALID_REQUEST', 'MISSING_REQUIRED_PARAMETER', c)
      if (sub.status !== 'SUSPENDED') fail(422, 'UNPROCESSABLE_ENTITY', 'SUBSCRIPTION_STATUS_INVALID', c)
      setStatus(sub, 'ACTIVE')
      return { status: 204, data: {}, call: c }
    },
    async cancel(id, reason) {
      const c = call('POST', `/v1/billing/subscriptions/${id}/cancel`)
      const sub = need(id, c)
      if (!reason) fail(400, 'INVALID_REQUEST', 'MISSING_REQUIRED_PARAMETER', c)
      if (sub.status === 'CANCELLED' || (sub.status === 'SUSPENDED' && !suspendedCancelWorks)) fail(422, 'UNPROCESSABLE_ENTITY', 'SUBSCRIPTION_STATUS_INVALID', c)
      setStatus(sub, 'CANCELLED')
      return { status: 204, data: {}, call: c }
    },
    async getCapture(captureId) {
      const c = call('GET', `/v2/payments/captures/${captureId}`)
      const found = findTxn(captureId)
      if (!found || !v2RefundWorks) fail(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', c)
      return { status: 200, data: { id: captureId, status: found.status, amount: found.amount_with_breakdown.gross_amount }, call: c }
    },
    async getCaptureRefunded(captureId) {
      const c = call('GET', `/v2/payments/captures/${captureId}`)
      if (!findTxn(captureId) || !v2RefundWorks) fail(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', c)
      const cents = [...refunds.values()].filter((r) => r.txnId === captureId).reduce((sum, r) => sum + Math.round(Number(r.amount.value) * 100), 0)
      return { status: 200, data: { refundedCents: cents }, call: c }
    },
    async refundCapture(captureId, { amountCents, requestId, note }) {
      const c = call('POST', `/v2/payments/captures/${captureId}/refund`)
      if (!v2RefundWorks || !findTxn(captureId)) fail(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', c)
      return { status: 201, data: publicRefund(doRefund(captureId, amountCents, requestId, note, c)), call: c }
    },
    async refundSale(saleId, { amountCents, requestId }) {
      const c = call('POST', `/v1/payments/sale/${saleId}/refund`)
      if (!findTxn(saleId)) fail(404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', c)
      const refund = publicRefund(doRefund(saleId, amountCents, requestId, null, c))
      return { status: 201, data: { id: refund.id, state: 'completed', amount: { total: refund.amount.value, currency: 'USD' }, sale_id: saleId, create_time: refund.create_time }, call: c }
    },
    refundsFor(txnId) { return [...refunds.values()].filter((r) => r.txnId === txnId) },
    allRefunds() { return [...refunds.values()] },
  }

  function findTxn(txnId) {
    for (const list of txns.values()) {
      const hit = list.find((t) => t.id === txnId)
      if (hit) return hit
    }
    return null
  }

  function doRefund(txnId, amountCents, requestId, note, c) {
    if (requestId && requestIds.has(requestId)) return requestIds.get(requestId)
    const txn = findTxn(txnId)
    const gross = Math.round(Number(txn.amount_with_breakdown.gross_amount.value) * 100)
    const done = [...refunds.values()].filter((r) => r.txnId === txnId).reduce((s, r) => s + Math.round(Number(r.amount.value) * 100), 0)
    if (!(amountCents > 0) || amountCents > gross - done) fail(422, 'UNPROCESSABLE_ENTITY', 'REFUND_AMOUNT_EXCEEDED', c)
    const refund = { id: `MOCK-REFUND-${rid(6)}`, status: 'COMPLETED', amount: money(amountCents), note_to_payer: note || undefined, create_time: iso(clock.now()), txnId }
    refunds.set(refund.id, refund)
    txn.status = done + amountCents >= gross ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
    if (requestId) requestIds.set(requestId, refund)
    return refund
  }
}
