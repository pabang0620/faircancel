import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeEnv, callsOf } from './helpers.js'
import { installTransport, networkError, STATUS_INVALID_BODY, liveWith, fakeFetch } from './helpersToolkit.js'
import { PayPalError, isTransient, isStatusInvalid, toolkitFailure } from '../server/paypal/errors.js'
import { parseReturnHint, pauseWeeksFor } from '../server/returnHint.js'
import { validateProposal } from '../server/offers.js'
import { groupActivity } from '../client/src/activityGroups.js'

const MENU = [2, 4, 6, 8]
const DAY = 86_400_000
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const net = () => new PayPalError(0, 'NETWORK', 'Network Error', { method: 'POST', path: 'x' })

// Wraps the local refund call so a test can count it and break it in a chosen way.
function spyRefund(env, { before = null, after = null } = {}) {
  const real = env.local.refundCapture.bind(env.local)
  const spy = { calls: [], requestIds: [] }
  env.local.refundCapture = async (id, opts) => {
    spy.calls.push(id)
    spy.requestIds.push(opts.requestId)
    if (before && before(spy.calls.length)) throw before(spy.calls.length)
    const out = await real(id, opts)
    if (after && after(spy.calls.length)) throw after(spy.calls.length)
    return out
  }
  return spy
}

async function tick(env, times) {
  for (let i = 0; i < times; i += 1) { env.clock.advance(30_000); await env.services.runDueWork() }
}

// ---- F1: refund retry, terminal state, idempotence ----

test('failed_refund_stops_retrying_and_is_shown_as_terminal', async () => {
  const env = makeEnv({ config: { mockV2Refund: false } })
  const spy = spyRefund(env)
  const v = await env.services.claim(env.sid, 2)
  const out = await env.services.cancel(env.sid, v.id, '')
  assert.equal(out.status, 'CANCELLED')
  assert.equal(out.result.phase, 'refund_failed')
  assert.equal(env.state.subs.get(v.id).pendingCancel, null)
  await tick(env, 4)
  assert.equal(spy.calls.length, 1, 'no timer retry after a definite refusal')
  const row = env.services.merchantView(env.sid).subscriptions[0]
  assert.equal(row.refundState, 'failed')
  assert.ok(row.refundError)
  const again = await env.services.cancel(env.sid, v.id, '')
  assert.equal(again.result.phase, 'refund_failed')
  assert.equal(spy.calls.length, 1, 'cancelling again does not refund again')
})

test('transient_refund_errors_stop_after_the_cap', async () => {
  const env = makeEnv({ config: { refundMaxTries: 3 } })
  const spy = spyRefund(env, { before: () => new PayPalError(503, 'SERVICE_UNAVAILABLE', 'outage', { method: 'POST', path: 'refund' }) })
  const v = await env.services.claim(env.sid, 2)
  const first = await env.services.cancel(env.sid, v.id, '')
  assert.equal(first.result.kind, 'queued')
  assert.match(first.result.message, /Your subscription is cancelled/)
  await tick(env, 5)
  assert.equal(spy.calls.length, 3)
  const view = await env.services.view(env.sid, v.id)
  assert.equal(view.result.phase, 'refund_failed')
  assert.equal(env.state.subs.get(v.id).pendingCancel, null)
})

test('refund_first_attempt_succeeded_but_response_lost_does_not_refund_twice', async () => {
  const env = makeEnv()
  const spy = spyRefund(env, { after: (n) => (n === 1 ? net() : null) })
  let reads = 0
  const realRead = env.local.getCaptureRefunded.bind(env.local)
  env.local.getCaptureRefunded = async (id) => { reads += 1; return realRead(id) }
  const v = await env.services.claim(env.sid, 2)
  const first = await env.services.cancel(env.sid, v.id, '')
  assert.equal(first.result.kind, 'queued')
  assert.equal(env.local.allRefunds().length, 1, 'PayPal did refund once')
  await tick(env, 1)
  assert.equal(reads, 1, 'the capture was re-read before retrying')
  assert.equal(spy.calls.length, 1, 'no second refund request was sent')
  const done = await env.services.view(env.sid, v.id)
  assert.equal(done.result.phase, 'done')
  assert.equal(done.result.refund.recovered, true)
  assert.equal(done.result.refund.amountLabel, '$7.71')
  assert.equal(env.local.allRefunds().length, 1)
  assert.equal(env.state.subs.get(v.id).refundedCents, 771)
})

test('refund_lost_request_that_never_landed_is_sent_on_retry', async () => {
  const env = makeEnv()
  const spy = spyRefund(env, { before: (n) => (n === 1 ? net() : null) })
  const v = await env.services.claim(env.sid, 2)
  await env.services.cancel(env.sid, v.id, '')
  assert.equal(env.local.allRefunds().length, 0)
  await tick(env, 1)
  assert.equal(spy.calls.length, 2)
  assert.equal(env.local.allRefunds().length, 1)
  assert.equal((await env.services.view(env.sid, v.id)).result.refund.recovered, false)
})

test('refund_request_id_is_stable_across_retries_on_both_paths', async () => {
  const env = makeEnv()
  const spy = spyRefund(env, { before: (n) => (n < 3 ? net() : null) })
  const v = await env.services.claim(env.sid, 2)
  await env.services.cancel(env.sid, v.id, '')
  await tick(env, 2)
  assert.equal(new Set(spy.requestIds).size, 1)
  assert.match(spy.requestIds[0], /^refund-I-MOCK[A-Z0-9]+-/)
  const sale = makeEnv({ config: { refundPath: 'v1sale' } })
  const ids = []
  const realSale = sale.local.refundSale.bind(sale.local)
  sale.local.refundSale = async (id, opts) => { ids.push(opts.requestId); if (ids.length === 1) throw net(); return realSale(id, opts) }
  const w = await sale.services.claim(sale.sid, 2)
  await sale.services.cancel(sale.sid, w.id, '')
  await tick(sale, 1)
  assert.equal(ids.length, 2)
  assert.equal(ids[0], ids[1])
  assert.equal(sale.local.allRefunds().length, 1)
})

test('live_v2_refund_sends_paypal_request_id_through_the_toolkit', async () => {
  const net_ = installTransport((config) => ({ status: 201, data: { id: '3C679366HH908993F', status: 'COMPLETED' } }))
  try {
    const live = liveWith()
    const out = await live.refundCapture('5O190127TN364715T', { amountCents: 771, requestId: 'refund-I-ABC-5O190127TN364715T', note: 'x' })
    assert.equal(out.data.id, '3C679366HH908993F')
    const refundCall = net_.seen.find((c) => c.url.includes('/refund'))
    assert.equal(refundCall.headers['PayPal-Request-Id'], 'refund-I-ABC-5O190127TN364715T')
    assert.match(refundCall.url, /\.sandbox\.paypal\.com/, 'sandbox host, never live')
  } finally { net_.restore() }
})

test('live_capture_refunded_total_is_read_from_the_capture', async () => {
  const body = { id: 'C1', status: 'PARTIALLY_REFUNDED', seller_payable_breakdown: { total_refunded_amount: { currency_code: 'USD', value: '7.71' } } }
  const fetchImpl = fakeFetch(() => body)
  const out = await liveWith(fetchImpl).getCaptureRefunded('C1')
  assert.equal(out.data.refundedCents, 771)
})

// ---- F2 and F3: Toolkit error shapes ----

test('toolkit_http_error_keeps_status_and_recognises_status_invalid', async () => {
  const t = installTransport(() => ({ status: 422, data: STATUS_INVALID_BODY }))
  try {
    const err = await liveWith().cancel('I-ABC123456', 'x').then(() => null, (e) => e)
    assert.ok(err instanceof PayPalError)
    assert.equal(err.status, 422)
    assert.equal(err.issue, 'SUBSCRIPTION_STATUS_INVALID')
    assert.equal(isStatusInvalid(err), true)
    assert.equal(isTransient(err), false)
  } finally { t.restore() }
})

test('toolkit_network_errors_are_transient', async () => {
  const t = installTransport(() => networkError())
  try {
    const err = await liveWith().cancel('I-ABC123456', 'x').then(() => null, (e) => e)
    assert.equal(err.status, 0)
    assert.equal(isTransient(err), true)
  } finally { t.restore() }
  const tokenDown = installTransport(() => networkError())
  try {
    // Fails while the toolkit fetches its token: the other error shape, { error: { message, type } }.
    const err = await liveWith().refundCapture('5O190127TN364715T', { amountCents: 100, requestId: 'r', note: 'n' }).then(() => null, (e) => e)
    assert.equal(isTransient(err), true)
  } finally { tokenDown.restore() }
})

test('toolkit_5xx_and_other_http_statuses', async () => {
  const t = installTransport(() => ({ status: 503, data: { name: 'SERVICE_UNAVAILABLE', message: 'Service Unavailable.' } }))
  try {
    assert.equal(isTransient(await liveWith().showSubscription('I-ABC123456').then(() => null, (e) => e)), true)
  } finally { t.restore() }
  const bad = installTransport(() => ({ status: 404, data: { name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.', details: [{ issue: 'INVALID_RESOURCE_ID', description: 'Requested resource ID was not found.' }] } }))
  try {
    const err = await liveWith().showSubscription('I-ABC123456').then(() => null, (e) => e)
    assert.equal(err.status, 404)
    assert.equal(isTransient(err), false)
  } finally { bad.restore() }
})

test('toolkit_failure_parser_handles_both_documented_shapes', () => {
  assert.equal(toolkitFailure({ id: 'I-1', status: 'ACTIVE' }, {}), null)
  assert.equal(toolkitFailure('', {}), null)
  assert.equal(toolkitFailure({ ok: false, status: 429, code: 'PAYPAL_API_HTTP_ERROR', message: 'Too many requests' }, {}).status, 429)
  assert.equal(toolkitFailure({ ok: false, code: 'PAYPAL_API_NO_RESPONSE', message: 'timeout of 0ms exceeded' }, {}).status, 0)
  assert.equal(toolkitFailure({ error: { message: 'Failed to fetch access token: Request failed with status code 401', type: 'paypal_error' } }, {}).status, 401)
  assert.equal(toolkitFailure({ error: { message: 'Something odd', type: 'paypal_error' } }, {}).status, 422)
})

test('cancel_of_a_suspended_subscription_falls_back_to_activate_then_cancel_with_toolkit_error', async () => {
  const t = installTransport(() => ({ status: 422, data: STATUS_INVALID_BODY }))
  let toolkitError
  try { toolkitError = await liveWith().cancel('I-ABC123456', 'x').then(() => null, (e) => e) } finally { t.restore() }
  const env = makeEnv()
  const real = env.local.cancel.bind(env.local)
  let first = true
  env.local.cancel = async (...a) => { if (first) { first = false; throw toolkitError } return real(...a) }
  const v = await env.services.claim(env.sid, 4)
  assert.equal(v.status, 'SUSPENDED')
  const out = await env.services.cancel(env.sid, v.id, '')
  assert.equal(out.status, 'CANCELLED')
  assert.equal(callsOf(env, v.id, 'activate').length, 1)
  assert.equal(callsOf(env, v.id, 'cancel').length, 1)
})

test('toolkit_network_error_on_cancel_shows_the_will_be_sent_again_screen', async () => {
  const t = installTransport(() => networkError())
  let err
  try { err = await liveWith().cancel('I-ABC123456', 'x').then(() => null, (e) => e) } finally { t.restore() }
  const env = makeEnv()
  const real = env.local.cancel.bind(env.local)
  let down = true
  env.local.cancel = async (...a) => { if (down) throw err; return real(...a) }
  const v = await env.services.claim(env.sid, 2)
  const first = await env.services.cancel(env.sid, v.id, '')
  assert.equal(first.result.kind, 'queued')
  assert.match(first.result.message, /will be sent again/)
  down = false
  await tick(env, 1)
  assert.equal((await env.services.view(env.sid, v.id)).status, 'CANCELLED')
})

test('non_transient_cancel_error_does_not_leave_a_retry_loop', async () => {
  const env = makeEnv()
  let calls = 0
  env.local.cancel = async () => { calls += 1; throw new PayPalError(403, 'NOT_AUTHORIZED', 'PERMISSION_DENIED', { method: 'POST', path: 'cancel' }) }
  const v = await env.services.claim(env.sid, 2)
  await assert.rejects(env.services.cancel(env.sid, v.id, ''))
  await tick(env, 3)
  assert.equal(calls, 1)
  assert.equal(env.state.subs.get(v.id).pendingCancel, null)
})

// ---- F4 and F5: local mode wording ----

test('local_mode_results_say_mock_and_use_no_paypal_looking_ids', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  assert.match(v.id, /^I-MOCK/)
  const out = await env.services.cancel(env.sid, v.id, '')
  assert.equal(out.backend, 'local')
  assert.match(out.result.refund.id, /^MOCK-REFUND-/)
  const card = read('client/src/components/ResultCard.jsx')
  assert.match(card, /local stand-in \(mock\)/)
  assert.match(card, /nothing was sent to PayPal/)
  assert.match(read('client/src/components/CancelNowBar.jsx'), /local stand-in/)
})

test('merchant_panel_says_the_agent_is_the_rule_based_stand_in_without_a_key', async () => {
  const env = makeEnv()
  assert.equal(env.services.merchantView(env.sid).agent.mode, 'stand-in')
  const v = await env.services.claim(env.sid, 1)
  await env.services.offer(env.sid, v.id, 'away until mid-January')
  const decision = env.services.merchantView(env.sid).decisions[0]
  assert.equal(decision.agentKind, 'stand-in')
  const panel = read('client/src/components/MerchantPanel.jsx')
  assert.match(panel, /rule-based stand-in/)
  const keyed = makeEnv({ config: { anthropicKey: 'sk-test', llmLiveUntil: Date.parse('2030-01-01') } })
  assert.equal(keyed.services.merchantView(keyed.sid).agent.mode, 'claude')
  const expired = makeEnv({ config: { anthropicKey: 'sk-test', llmLiveUntil: 0 } })
  assert.equal(expired.services.merchantView(expired.sid).agent.mode, 'stand-in')
})

// ---- F6: nothing hardcodes the weeks ----

test('pause_length_follows_todays_date_not_a_fixed_number', () => {
  const weeksOn = (day) => pauseWeeksFor(parseReturnHint('Visiting family until mid-January', Date.parse(`${day}T12:00:00Z`)).weeks, MENU)
  assert.equal(weeksOn('2026-11-12'), 8)
  assert.equal(weeksOn('2026-12-01'), 6)
  assert.equal(weeksOn('2026-12-08'), 6)
  assert.equal(weeksOn('2026-12-15'), 4)
  assert.equal(weeksOn('2027-01-05'), 2)
})

test('readme_and_screens_do_not_hardcode_the_pause_length', () => {
  const readme = read('README.md')
  assert.doesNotMatch(readme, /Agent: pause \d weeks/)
  assert.doesNotMatch(readme, /mid-January is about 9 weeks away/)
  for (const f of ['MerchantPanel', 'OfferCard', 'SubscriberPanel', 'JudgePage']) assert.doesNotMatch(read(`client/src/components/${f}.jsx`), /pause [2468] weeks|mid-January/i)
})

// ---- F7: return hints ----

test('may_the_verb_is_not_a_month', () => {
  const now = Date.parse('2026-11-12T20:00:00Z')
  assert.equal(parseReturnHint('I may be back in 3 weeks', now).weeks, 3)
  assert.equal(parseReturnHint('may I pause instead?', now), null)
  assert.equal(parseReturnHint('I may return after the exams', now), null)
  assert.ok(parseReturnHint('back in May', now).weeks > 20, 'May the month still works with a preposition')
  assert.ok(parseReturnHint('away until May 5', now).weeks > 20)
  assert.equal(validateProposal({ type: 'pause', weeks: 4 }, { menu: MENU, reason: 'I may be back in 3 weeks', now }).weeks, 4)
})

test('back_by_march_is_read_as_the_start_of_march_and_is_too_far_for_a_pause', () => {
  const now = Date.parse('2026-11-12T20:00:00Z')
  const hint = parseReturnHint('I will be back by march', now)
  assert.equal(new Date(hint.returnAt).toISOString().slice(0, 10), '2027-03-01')
  assert.equal(pauseWeeksFor(hint.weeks, MENU), null)
  assert.equal(validateProposal({ type: 'pause', weeks: 8 }, { menu: MENU, reason: 'back by march', now }).dropped, 'return_too_far')
  assert.equal(pauseWeeksFor(parseReturnHint('back by december', now).weeks, MENU), 2)
  assert.equal(new Date(parseReturnHint('until early march', now).returnAt).toISOString().slice(0, 10), '2027-03-05')
})

// ---- F8: reset and caps ----

test('judge_can_reset_their_own_session_and_run_a_scenario_again', async () => {
  const env = makeEnv({ config: { maxSeedsPerSession: 2 } })
  await env.services.claim(env.sid, 1)
  await env.services.claim(env.sid, 2)
  await assert.rejects(env.services.claim(env.sid, 3), /Start over/)
  const other = await env.services.claim('33333333-3333-4333-8333-333333333333', 2)
  const out = await env.services.resetSession(env.sid)
  assert.equal(out.removed, 2)
  assert.equal(env.services.merchantView(env.sid).subscriptions.length, 0)
  assert.ok(env.state.subs.has(other.id), 'another session is untouched')
  assert.equal((await env.services.claim(env.sid, 3)).scenario, 3)
})

test('reset_returns_only_untouched_sandbox_seeds_to_the_pool', async () => {
  const env = makeEnv()
  const local = env.local
  const ids = [1, 2].map(() => local.seedSubscription({ paidAt: env.clock.now() - DAY }))
  env.state.clients.sandbox = local
  env.services.seedFile.write(ids.map((id) => ({ subscriptionId: id })))
  const a = await env.services.claim(env.sid, 2)
  const b = await env.services.claim(env.sid, 3)
  await env.services.cancel(env.sid, b.id, '')
  const out = await env.services.resetSession(env.sid)
  assert.deepEqual([out.removed, out.released], [2, 1])
  assert.equal(env.services.poolStatus().ready, 1)
  assert.ok(a.id)
})

test('new_sessions_per_ip_are_capped_so_the_seed_pool_cannot_be_drained', async () => {
  const env = makeEnv({ config: { newSessionsPerIpHour: 3 } })
  const ids = Array.from({ length: 5 }, (_, i) => `4444444${i}-4444-4444-8444-444444444444`)
  const results = []
  for (const id of ids) results.push(await env.services.claim(id, 2, false, { ip: '203.0.113.9' }).then(() => 'ok', (e) => e.status))
  assert.deepEqual(results, ['ok', 'ok', 'ok', 429, 429])
  await env.services.claim(env.sid, 2, false, { ip: '203.0.113.10' })
  await env.services.claim(ids[0], 3, false, { ip: '203.0.113.9' })
  env.clock.advance(3_600_001)
  await env.services.claim(ids[4], 2, false, { ip: '203.0.113.9' })
})

test('sandbox_seeds_taken_per_ip_are_capped_even_when_sessions_are_reset', async () => {
  const env = makeEnv({ config: { seedsPerIpHour: 2 } })
  const ids = [1, 2, 3].map(() => env.local.seedSubscription({ paidAt: env.clock.now() - DAY }))
  env.state.clients.sandbox = env.local
  env.services.seedFile.write(ids.map((id) => ({ subscriptionId: id })))
  await env.services.claim(env.sid, 1, false, { ip: '198.51.100.1' })
  await env.services.resetSession(env.sid)
  await env.services.claim(env.sid, 1, false, { ip: '198.51.100.1' })
  await env.services.resetSession(env.sid)
  await assert.rejects(env.services.claim(env.sid, 1, false, { ip: '198.51.100.1' }), /Too many sandbox subscriptions/)
})

// ---- F9 to F12 ----

test('mobile_send_button_is_not_stretched_to_full_width', () => {
  const css = read('client/src/styles.css')
  const media = css.slice(css.indexOf('@media (max-width: 900px)'))
  assert.match(media, /\.btn--quiet \{ width: auto; flex: none; \}/)
  assert.ok(media.indexOf('.btn--quiet') > media.indexOf('.btn--action'), 'later rule wins')
})

test('cancel_now_clickable_while_loading_or_error', () => {
  const bar = read('client/src/components/CancelNowBar.jsx')
  assert.ok(!bar.includes('!view}'), 'no missing-view disable')
  assert.match(bar, /disabled=\{cancelled \|\| busy === 'cancel'\}/)
  assert.match(read('client/src/components/SubscriberPanel.jsx'), /api\.view\(sessionId, subscriptionId, true\)\.catch\(\(\) => null\)/)
})

test('offer_card_shows_what_the_subscriber_said', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 1)
  const out = await env.services.offer(env.sid, v.id, 'Visiting family until mid-January')
  assert.equal(out.view.offer.returnHint, 'mid-January')
  assert.match(read('client/src/components/OfferCard.jsx'), /you said \{offer\.returnHint\}/)
  const now = Date.parse('2026-11-12T20:00:00Z')
  assert.equal(validateProposal({ type: 'pause', weeks: 4, return_hint: 'a trip to $99.00 land' }, { menu: MENU, reason: 'taking a break', now }).returnHint, null)
  assert.equal(validateProposal({ type: 'pause', weeks: 4, return_hint: 'a break' }, { menu: MENU, reason: 'taking a break', now }).returnHint, 'a break')
})

test('sync_result_fields_reach_the_merchant_panel', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  assert.equal(env.services.merchantView(env.sid).subscriptions[0].lastSync, null)
  await env.services.sync(env.sid, v.id)
  const sync = env.services.merchantView(env.sid).subscriptions[0].lastSync
  assert.equal(sync.paypalStatus, 'ACTIVE')
  assert.ok(sync.nextBillingTime)
  assert.ok(sync.syncedAt)
  assert.match(read('client/src/components/MerchantPanel.jsx'), /PayPal says/)
})

// ---- F13 and F14 ----

test('seeds_are_excluded_only_on_permanent_errors', async () => {
  const env = makeEnv()
  const cancelled = env.local.seedSubscription({ paidAt: env.clock.now() - DAY })
  env.local.buyerCancelsAtPayPal(cancelled)
  const unpaid = env.local.seedSubscription({ paidAt: env.clock.now() - DAY, txnStatus: 'PENDING' })
  const flaky = env.local.seedSubscription({ paidAt: env.clock.now() - DAY })
  env.state.clients.sandbox = env.local
  env.services.seedFile.write([cancelled, unpaid, flaky].map((id) => ({ subscriptionId: id })))
  const real = env.local.showSubscription.bind(env.local)
  env.local.showSubscription = async (id) => { if (id === flaky) throw new PayPalError(503, 'SERVICE_UNAVAILABLE', 'outage', { method: 'GET', path: 'x' }); return real(id) }
  await assert.rejects(env.services.claim(env.sid, 2), (e) => e.status === 503)
  const seeds = Object.fromEntries(env.services.seedFile.read().map((s) => [s.subscriptionId, s]))
  assert.equal(seeds[cancelled].bad, true, 'cancelled can never come back')
  assert.equal(seeds[unpaid].bad, undefined, 'first payment may still complete')
  assert.equal(seeds[flaky].bad, undefined, 'a network blip is not the seed\'s fault')
  env.local.showSubscription = real
  assert.equal((await env.services.claim(env.sid, 2)).id, flaky)
})

test('transactions_window_is_computed_per_call', async () => {
  const starts = []
  const fetchImpl = fakeFetch((url) => { starts.push(new URL(url).searchParams.get('start_time')); return { transactions: [] } })
  const live = liveWith(fetchImpl)
  const realNow = Date.now
  try {
    Date.now = () => Date.parse('2026-11-12T00:00:00Z')
    await live.listTransactions('I-ABC123456')
    Date.now = () => Date.parse('2027-02-01T00:00:00Z')
    await live.listTransactions('I-ABC123456')
  } finally { Date.now = realNow }
  assert.equal(starts[0].slice(0, 10), '2026-09-28')
  assert.equal(starts[1].slice(0, 10), '2026-12-18')
})

// ---- F15 ----

test('repeated_transaction_reads_collapse_into_one_activity_row', () => {
  const row = (id, method, path, status = 200) => ({ id, method, path, status, ok: true, backend: 'local' })
  const out = groupActivity([
    row(1, 'GET', '/t'), row(2, 'GET', '/t'), row(3, 'GET', '/t'),
    row(4, 'POST', '/suspend', 204),
    row(5, 'GET', '/t'),
    row(6, 'POST', '/cancel', 204), row(7, 'POST', '/cancel', 204),
  ])
  assert.deepEqual(out.map((r) => [r.method, r.count]), [['GET', 3], ['POST', 1], ['GET', 1], ['POST', 1], ['POST', 1]])
  assert.equal(groupActivity([row(1, 'GET', '/t', 200), row(2, 'GET', '/t', 500)]).length, 2)
})
