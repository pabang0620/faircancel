import { usd } from './money.js'

export const DAY_MS = 86_400_000
export const PLAN_PERIOD_DAYS = 7
const BILLING_MISMATCH_MS = 3_600_000
const PAID_STATUSES = new Set(['COMPLETED', 'PARTIALLY_REFUNDED'])

// Normalizes one PayPal subscription transaction (subscription_transaction_details) to cents.
export function normalizeTransaction(txn) {
  const gross = txn.amount_with_breakdown?.gross_amount
  return {
    id: txn.id,
    status: txn.status,
    amountCents: gross ? Math.round(Number(gross.value) * 100) : 0,
    paidAt: Date.parse(txn.time),
    refundedCents: txn.refundedCents || 0,
  }
}

// The reference payment is the latest COMPLETED one from the subscription transactions,
// not billing_info (which can lag behind right after a charge).
export function pickReferencePayment(transactions) {
  const normalized = transactions.map(normalizeTransaction)
  const paid = normalized.filter((t) => PAID_STATUSES.has(t.status)).sort((a, b) => b.paidAt - a.paidAt)
  const pending = normalized.filter((t) => t.status === 'PENDING').sort((a, b) => b.paidAt - a.paidAt)
  return { payment: paid[0] || null, pending: pending[0] || null }
}

export function reconcileBillingInfo(payment, billingInfoTime) {
  if (!payment || !billingInfoTime) return { mismatch: false }
  const billed = Date.parse(billingInfoTime)
  const mismatch = Number.isFinite(billed) && Math.abs(billed - payment.paidAt) > BILLING_MISMATCH_MS
  return { mismatch, billingInfoTime, transactionTime: new Date(payment.paidAt).toISOString() }
}

const daysLabel = (ms) => (Math.max(ms, 0) / DAY_MS).toFixed(1)

/**
 * Refund quote for "cancel now". Pure function, no model involved.
 * Order (merchant policy): zero usage this period -> full payment; else merchant "access until
 * the end" -> 0; else floor_to_cent(amount x unused time / period time).
 */
export function quoteRefund({ transactions, usageCount, now, policy, billingInfoTime, periodDays = PLAN_PERIOD_DAYS, refundedCents = 0 }) {
  const { payment, pending } = pickReferencePayment(transactions)
  const base = { policy, usageCount, now: new Date(now).toISOString() }
  if (!payment) {
    if (pending) return { ...base, held: true, cents: 0, reason: 'payment_pending', message: 'Your latest payment is still pending at PayPal. Cancel is done; the refund will be sent when it completes.' }
    return { ...base, held: false, cents: 0, reason: 'no_completed_payment', message: 'No completed payment this week, so nothing to refund.' }
  }
  const periodMs = periodDays * DAY_MS
  const paidAt = payment.paidAt
  const periodEnd = paidAt + periodMs
  const reconcile = reconcileBillingInfo(payment, billingInfoTime)
  const detail = { ...base, payment, paidAt: new Date(paidAt).toISOString(), periodEnd: new Date(periodEnd).toISOString(), reconcile }
  if (now >= periodEnd) {
    return { ...detail, held: false, cents: 0, reason: 'no_completed_payment', message: 'No completed payment this week, so nothing to refund.' }
  }
  const refundable = Math.max(payment.amountCents - Math.max(payment.refundedCents, refundedCents), 0)
  const remainingMs = periodEnd - now
  let cents
  let reason
  let formula
  if (usageCount === 0 && policy.fullRefundIfNoUsage) {
    cents = payment.amountCents
    reason = 'zero_usage_full'
    formula = refundable < payment.amountCents
      ? `No class attended this week, so ${usd(refundable)} goes back (${usd(payment.amountCents - refundable)} of the ${usd(payment.amountCents)} payment was already refunded)`
      : `No class attended this week, so the full ${usd(payment.amountCents)} goes back`
  } else if (policy.refundMode === 'access_until_end') {
    cents = 0
    reason = 'access_until_end'
    formula = `Access until ${new Date(periodEnd).toISOString()}`
  } else {
    cents = Math.floor((payment.amountCents * remainingMs) / periodMs)
    reason = 'prorated'
    formula = `${usd(payment.amountCents)} x ${daysLabel(remainingMs)} of ${periodDays} days unused = ${usd(Math.min(cents, refundable))}`
  }
  const capped = Math.min(cents, refundable)
  return { ...detail, held: false, cents: capped, uncappedCents: cents, reason, formula, message: null }
}
