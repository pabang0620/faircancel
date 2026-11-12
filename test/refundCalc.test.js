import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quoteRefund, DAY_MS } from '../server/refundCalc.js'
import { makeEnv, callsOf, START } from './helpers.js'

const policy = { refundMode: 'prorate', fullRefundIfNoUsage: true }
const txn = (over = {}) => ({ id: 'TXN1', status: 'COMPLETED', amount_with_breakdown: { gross_amount: { currency_code: 'USD', value: '9.00' } }, time: new Date(START - DAY_MS).toISOString(), ...over })

test('refund_zero_usage_full_first', () => {
  const q = quoteRefund({ transactions: [txn()], usageCount: 0, now: START, policy })
  assert.equal(q.cents, 900)
  assert.equal(q.reason, 'zero_usage_full')
  // zero usage wins even when the merchant chose "access until the end"
  assert.equal(quoteRefund({ transactions: [txn()], usageCount: 0, now: START, policy: { ...policy, refundMode: 'access_until_end' } }).cents, 900)
})

test('refund_prorated_floor_to_cent', () => {
  const q = quoteRefund({ transactions: [txn()], usageCount: 1, now: START, policy })
  assert.equal(q.cents, 771) // $9.00 x 6/7 = 7.714... floored
  assert.equal(q.formula, '$9.00 x 6.0 of 7 days unused = $7.71')
  assert.equal(quoteRefund({ transactions: [txn()], usageCount: 1, now: START, policy: { ...policy, refundMode: 'access_until_end' } }).cents, 0)
})

test('refund_capped_by_refundable_balance', () => {
  const q = quoteRefund({ transactions: [txn()], usageCount: 0, now: START, policy, refundedCents: 600 })
  assert.equal(q.cents, 300)
  const gone = quoteRefund({ transactions: [txn()], usageCount: 1, now: START, policy, refundedCents: 900 })
  assert.equal(gone.cents, 0)
})

test('refund_uses_completed_payment_not_stale_billing_info', () => {
  const older = txn({ id: 'OLD', time: new Date(START - 8 * DAY_MS).toISOString() })
  const staleBilling = new Date(START - 8 * DAY_MS).toISOString()
  const q = quoteRefund({ transactions: [older, txn()], usageCount: 1, now: START, policy, billingInfoTime: staleBilling })
  assert.equal(q.payment.id, 'TXN1')
  assert.equal(q.cents, 771)
  assert.equal(q.reconcile.mismatch, true)
  // nothing paid in the last 7 days: no refund
  const none = quoteRefund({ transactions: [older], usageCount: 1, now: START, policy })
  assert.equal(none.cents, 0)
  assert.equal(none.message, 'No completed payment this week, so nothing to refund.')
})

test('refund_held_when_payment_pending', () => {
  const q = quoteRefund({ transactions: [txn({ status: 'PENDING' })], usageCount: 1, now: START, policy })
  assert.equal(q.held, true)
  assert.equal(q.cents, 0)
})

test('refund_path_fixed_no_double_path', async () => {
  const env = makeEnv({ config: { mockV2Refund: false } }) // v2 capture refund rejected by the stand-in
  const view = await env.services.claim(env.sid, 2)
  const out = await env.services.cancel(env.sid, view.id, '')
  assert.equal(out.status, 'CANCELLED')
  assert.equal(out.result.phase, 'refund_failed')
  assert.equal(env.local.allRefunds().length, 0, 'no second path was tried')
  assert.equal(env.state.activity.all().filter((a) => a.op === 'refundSale').length, 0)
})

test('refund_idempotent_same_request_id', async () => {
  const env = makeEnv()
  const view = await env.services.claim(env.sid, 2)
  await env.services.cancel(env.sid, view.id, '')
  await env.services.cancel(env.sid, view.id, '')
  assert.equal(env.local.allRefunds().length, 1)
  // the stand-in also honours the same PayPal-Request-Id
  const txnId = env.state.subs.get(view.id).refund.txnId
  const again = await env.local.refundCapture(txnId, { amountCents: 100, requestId: `refund-${view.id}-${txnId}` })
  assert.equal(again.data.id, env.state.subs.get(view.id).refund.id)
  assert.equal(env.local.allRefunds().length, 1)
})

test('v1 sale refund path works when it is the fixed path', async () => {
  const env = makeEnv({ config: { refundPath: 'v1sale', mockV2Refund: false } })
  const view = await env.services.claim(env.sid, 2)
  const out = await env.services.cancel(env.sid, view.id, '')
  assert.equal(out.result.refund.path, 'v1 sale refund')
  assert.equal(out.result.refund.amountLabel, '$7.71')
  assert.equal(callsOf(env, view.id, 'refundSale').length, 1)
})

test('days_label_does_not_round_up_to_the_full_period', () => {
  const paidMinutesAgo = txn({ time: new Date(START - 5 * 60_000).toISOString() })
  const q = quoteRefund({ transactions: [paidMinutesAgo], usageCount: 1, now: START, policy })
  assert.equal(q.cents, 898)
  assert.equal(q.formula, '$9.00 x 6.99 of 7 days unused = $8.98')
})

test('formula_label_reproduces_the_charged_amount', () => {
  for (const offsetMs of [0, 60_000, 5 * 60_000, 3_600_000, 7 * 3_600_000 + 12_345, 86_399_999, 2 * DAY_MS + 777]) {
    for (const amount of ['9.00', '8.99', '19.95']) {
      const t = txn({ time: new Date(START - offsetMs).toISOString(), amount_with_breakdown: { gross_amount: { currency_code: 'USD', value: amount } } })
      const q = quoteRefund({ transactions: [t], usageCount: 1, now: START, policy })
      const m = q.formula.match(/^\$([\d.]+) x ([\d.]+) of 7 days unused = \$([\d.]+)$/)
      assert.ok(m, q.formula)
      const shown = Math.floor((Math.round(Number(m[1]) * 100) * Math.round(Number(m[2]) * 100)) / 700)
      assert.equal(shown, Math.round(Number(m[3]) * 100))
      assert.equal(shown, q.cents)
    }
  }
})

test('hint_quotes_only_the_time_phrase', async () => {
  const { timePhrase } = await import('../server/offers.js')
  assert.equal(timePhrase('Back after the holidays, my kid is home'), 'after the holidays')
  assert.equal(timePhrase('until mid-January'), 'until mid-January')
})
