import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEnv, callsOf } from './helpers.js'
import { PayPalError } from '../server/paypal/errors.js'
import { parseReturnHint, pauseWeeksFor, closestMenuWeeks } from '../server/returnHint.js'
import { validateProposal } from '../server/offers.js'
import { sanitizeModelText, runTool, createToolContext, MAX_TOOL_CALLS } from '../server/agent/tools.js'
import { claudeDecide } from '../server/agent/claudeAgent.js'
import { STATE_RULE_LAYER, merchantPolicyPatchSchema } from '../server/policy.js'

const MENU = [2, 4, 6, 8]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('scenario 1: mid-January pause is 8 weeks and resumes Jan 7', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 1)
  const o = await env.services.offer(env.sid, v.id, 'Visiting family until mid-January, then I will be back')
  const detail = env.state.subs.get(v.id).offer
  assert.equal(detail.rule.weeks, 2)
  assert.equal(detail.agent.weeks, 8)
  assert.equal(o.offer.weeks, 8)
  const paused = await env.services.pause(env.sid, v.id)
  assert.equal(paused.status, 'SUSPENDED')
  assert.equal(paused.pauseResult.resumeAt.slice(0, 10), '2027-01-07')
  assert.equal(callsOf(env, v.id, 'suspend').length, 1)
})

test('scenario 2: cancel refunds $7.71 on PayPal and the quote line matched', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  assert.equal(v.cancelQuote.amount, '$7.71')
  const o = await env.services.offer(env.sid, v.id, 'Too expensive right now')
  assert.equal(o.offer.type, 'none')
  const out = await env.services.cancel(env.sid, v.id, 'Too expensive right now')
  assert.equal(out.status, 'CANCELLED')
  assert.equal(out.result.refund.amountLabel, '$7.71')
  assert.equal(out.result.quote.formula, '$9.00 x 6.0 of 7 days unused = $7.71')
  assert.equal(out.result.refund.path, 'v2 capture refund')
  assert.equal(out.result.policy.by, 'Clay Studio')
})

test('scenario 3: zero attendance refunds the full $9.00', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 3)
  await env.services.offer(env.sid, v.id, 'I was charged yesterday but could not make any class this week')
  const steps = env.state.subs.get(v.id).offer.steps.map((s) => s.tool)
  assert.deepEqual(steps, ['get_policy', 'list_recent_payments', 'get_usage_record', 'quote_refund', 'propose_offer'])
  const out = await env.services.cancel(env.sid, v.id, '')
  assert.equal(out.result.refund.amountLabel, '$9.00')
})

test('scenario 4: a paused seed resumes with one click, sync shows ACTIVE', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 4)
  assert.equal(v.status, 'SUSPENDED')
  const back = await env.services.resume(env.sid, v.id)
  assert.equal(back.status, 'ACTIVE')
  const s = await env.services.sync(env.sid, v.id)
  assert.equal(s.sync.paypalStatus, 'ACTIVE')
})

test('pause_weeks_from_return_hint_within_menu', () => {
  for (const text of ['until mid-January', 'surgery next week, maybe 5 weeks off', 'back in 3 weeks', 'in two months']) {
    const hint = parseReturnHint(text, Date.parse('2026-11-12T20:00:00Z'))
    const weeks = pauseWeeksFor(hint.weeks, MENU)
    assert.ok(MENU.includes(weeks), `${text} -> ${weeks}`)
  }
  assert.equal(pauseWeeksFor(40, MENU), null)
})

test('pause_weeks_closest_to_return_date', () => {
  const now = Date.parse('2026-11-12T20:00:00Z')
  assert.equal(pauseWeeksFor(parseReturnHint('until mid-January', now).weeks, MENU), 8)
  assert.equal(pauseWeeksFor(parseReturnHint('Back in about 6 weeks after surgery', now).weeks, MENU), 6)
  assert.equal(closestMenuWeeks(5, MENU), 6) // tie goes to the longer pause
  assert.equal(closestMenuWeeks(3, MENU), 4)
})

test('offer_shown_at_most_once_per_subscription', async () => {
  let runs = 0
  const env = makeEnv({ agent: async (ctx) => { runs += 1; ctx.proposal = { type: 'pause', weeks: 4, return_hint: 'x' } } })
  const v = await env.services.claim(env.sid, 1)
  const first = await env.services.offer(env.sid, v.id, 'away for a month')
  const second = await env.services.offer(env.sid, v.id, 'back in 6 weeks')
  assert.equal(first.offer.type, 'pause')
  assert.equal(second.repeat, true)
  assert.equal(second.offer.weeks, first.offer.weeks)
  assert.equal(runs, 1)
})

test('offer_outside_policy_is_dropped', () => {
  const ctx = { menu: MENU, reason: 'a break', now: Date.now() }
  assert.equal(validateProposal({ type: 'pause', weeks: 5 }, ctx).type, 'none')
  assert.equal(validateProposal({ type: 'pause', weeks: 5 }, ctx).dropped, 'outside_policy_menu')
  assert.equal(validateProposal({ type: 'pause', weeks: 4 }, ctx).weeks, 4)
})

test('offer_never_discount', async () => {
  const ctx = { menu: MENU, reason: 'too expensive', now: Date.now() }
  for (const type of ['discount', 'coupon', 'price_cut', 'downgrade']) assert.equal(validateProposal({ type, weeks: 2 }, ctx).type, 'none')
  const env = makeEnv({ agent: async (c) => { c.proposal = { type: 'discount', weeks: 2 } } })
  const v = await env.services.claim(env.sid, 2)
  const out = await env.services.offer(env.sid, v.id, '50% off and I stay')
  assert.equal(out.offer.type, 'none')
})

test('rule_card_shown_when_model_late', async () => {
  const env = makeEnv({ config: { agentTimeoutMs: 40 }, agent: () => new Promise(() => {}) })
  const v = await env.services.claim(env.sid, 1)
  const out = await env.services.offer(env.sid, v.id, 'I will be away for a while')
  const detail = env.state.subs.get(v.id).offer
  assert.equal(detail.source, 'rule')
  assert.equal(detail.agentLate, true)
  assert.equal(out.offer.weeks, 2)
})

test('cancel_now_never_waits_for_model', async () => {
  const env = makeEnv({ config: { agentTimeoutMs: 300 }, agent: () => new Promise(() => {}) })
  const v = await env.services.claim(env.sid, 2)
  const pending = env.services.offer(env.sid, v.id, 'maybe I will pause')
  await sleep(10)
  const started = Date.now()
  const out = await env.services.cancel(env.sid, v.id, '')
  assert.ok(Date.now() - started < 500)
  assert.equal(out.status, 'CANCELLED')
  const late = await pending.catch((e) => e)
  assert.ok(late instanceof Error || late.offer.type === 'none')
})

test('cancel_button_visible_in_every_state', async () => {
  const env = makeEnv()
  for (const scenario of [1, 4]) {
    const v = await env.services.claim(env.sid, scenario)
    assert.ok(v.cancelQuote, `scenario ${scenario}: server sends the quote for the Cancel now line`)
  }
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../client/src/components/SubscriberPanel.jsx', import.meta.url), 'utf8')
  const bar = src.indexOf('<CancelNowBar')
  assert.ok(bar > 0, 'CancelNowBar is rendered')
  const line = src.slice(src.lastIndexOf('\n', bar) + 1, src.indexOf('\n', bar))
  assert.ok(line.trim().startsWith('<CancelNowBar'), 'Cancel now is never behind a condition')
  assert.ok(src.indexOf('function StateBody') > bar, 'it renders before the state branches')
  const bar2 = readFileSync(new URL('../client/src/components/CancelNowBar.jsx', import.meta.url), 'utf8')
  assert.ok(bar2.includes("view?.status === 'CANCELLED'") && bar2.includes("disabled={cancelled || busy === 'cancel'}"), 'button is disabled only once cancelled or while its own request runs')
})

test('cancel_line_shows_server_refund_quote', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  const fresh = await env.services.view(env.sid, v.id, { fresh: true })
  const out = await env.services.cancel(env.sid, v.id, '')
  assert.equal(fresh.cancelQuote.amount, out.result.refund.amountLabel)
})

test('model_amount_never_rendered', async () => {
  assert.equal(sanitizeModelText('You will get $99.00 back', [771]), null)
  assert.equal(sanitizeModelText('You will get $7.71 back', [771]), 'You will get $7.71 back')
  const env = makeEnv({ agent: async (c) => { c.proposal = { type: 'none' }; c.modelText = 'Sure, refund is $50.00' } })
  const v = await env.services.claim(env.sid, 2)
  await env.services.offer(env.sid, v.id, 'too expensive')
  const view = await env.services.view(env.sid, v.id)
  assert.equal(JSON.stringify(view).includes('50.00'), false)
})

test('double_click_cancel_one_call', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => env.services.cancel(env.sid, v.id, '')))
  assert.equal(a.status, 'CANCELLED')
  assert.equal(callsOf(env, v.id, 'cancel').length, 1)
  assert.equal(env.local.allRefunds().length, 1)
  assert.equal(b.result.refund.id, c.result.refund.id)
})

test('cancel_and_pause_race_one_wins', async () => {
  const env = makeEnv({ agent: async (c) => { c.proposal = { type: 'pause', weeks: 4 } } })
  const v = await env.services.claim(env.sid, 1)
  await env.services.offer(env.sid, v.id, 'away for 4 weeks')
  const results = await Promise.allSettled([env.services.pause(env.sid, v.id), env.services.cancel(env.sid, v.id, '')])
  const final = await env.services.view(env.sid, v.id)
  assert.equal(final.status, 'CANCELLED', 'cancel is final whichever request got the lock first')
  assert.equal(env.local.allRefunds().length, 1)
  assert.ok(callsOf(env, v.id, 'suspend').length <= 1)
  assert.ok(results.some((r) => r.status === 'fulfilled'))
  await assert.rejects(env.services.pause(env.sid, v.id), /cancel|already|active/i)
})

test('cancel_retry_keeps_request_time', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  const real = env.local.cancel.bind(env.local)
  let fail = true
  env.local.cancel = async (...a) => { if (fail) throw new PayPalError(503, 'SERVICE_UNAVAILABLE', 'outage', { method: 'POST', path: 'cancel' }); return real(...a) }
  const first = await env.services.cancel(env.sid, v.id, '')
  assert.equal(first.result.kind, 'queued')
  const requestedAt = first.result.requestedAt
  env.clock.advance(60 * 60 * 1000 / 4) // 15 minutes later PayPal is back
  fail = false
  await env.services.runDueWork()
  const done = await env.services.view(env.sid, v.id)
  assert.equal(done.status, 'CANCELLED')
  assert.equal(new Date(env.state.subs.get(v.id).pendingCancel?.requestedAt ?? env.state.subs.get(v.id).requestedAtMs).toISOString(), requestedAt)
  // refund is computed at the saved request time, not the later retry time
  assert.equal(done.result.refund.amountLabel, '$7.71')
})

test('scheduled_resume_calls_activate_once', async () => {
  const env = makeEnv({ agent: async (c) => { c.proposal = { type: 'pause', weeks: 2 } } })
  const v = await env.services.claim(env.sid, 1)
  await env.services.offer(env.sid, v.id, 'away 2 weeks')
  await env.services.pause(env.sid, v.id)
  await env.services.runDueWork()
  assert.equal(callsOf(env, v.id, 'activate').length, 0, 'not due yet')
  env.clock.advance(15 * 86_400_000)
  await Promise.all([env.services.runDueWork(), env.services.runDueWork()])
  assert.equal(callsOf(env, v.id, 'activate').length, 1)
  assert.equal((await env.services.view(env.sid, v.id)).status, 'ACTIVE')
})

test('sync_reads_paypal_state', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  env.local.buyerCancelsAtPayPal(v.id) // the subscriber cancelled inside PayPal itself
  assert.equal((await env.services.view(env.sid, v.id)).status, 'ACTIVE')
  const s = await env.services.sync(env.sid, v.id)
  assert.equal(s.view.status, 'CANCELLED')
  // a webhook only triggers the same re-read
  const w = await env.services.applyWebhook({ event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: v.id } })
  assert.equal(w.handled, true)
  assert.equal((await env.services.applyWebhook({ event_type: 'X', resource: { id: 'I-UNKNOWN123456' } })).handled, false)
})

test('state_rule_layer_cannot_be_disabled_by_merchant', () => {
  const env = makeEnv()
  assert.throws(() => env.state.policyStore.update({ cancelNowAlwaysVisible: false }))
  assert.throws(() => env.state.policyStore.update({ state: { locked: false } }))
  assert.throws(() => merchantPolicyPatchSchema.parse({ maxOffers: 5 }))
  env.state.policyStore.update({ refundMode: 'access_until_end' })
  const p = env.state.policyStore.get()
  assert.equal(p.state.cancelNowAlwaysVisible, true)
  assert.equal(p.state.locked, true)
  assert.throws(() => { STATE_RULE_LAYER.locked = false }, TypeError)
})

test('agent_stops_at_tool_cap', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  const ctx = createToolContext({ state: env.state, sub: env.state.subs.get(v.id), reason: 'x' })
  let rounds = 0
  const complete = async () => {
    rounds += 1
    return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${rounds}`, name: 'get_usage_record', input: {} }] }
  }
  await claudeDecide(ctx, { apiKey: 'unused', model: 'test', complete })
  assert.ok(ctx.calls.length <= MAX_TOOL_CALLS)
  assert.equal(ctx.lookups, 5)
  assert.equal(ctx.capped, true)
  assert.ok(rounds <= 9)
  const refused = await runTool(ctx, 'quote_refund')
  assert.equal(refused.ok, false)
})

test('judge_seed_claimed_once', async () => {
  const env = makeEnv()
  const other = '11111111-1111-4111-8111-111111111111'
  const [a, b] = await Promise.all([env.services.claim(env.sid, 2), env.services.claim(other, 2)])
  assert.notEqual(a.id, b.id)
  const again = await env.services.claim(env.sid, 2)
  assert.equal(again.id, a.id)
  await env.services.claim(env.sid, 1)
  await env.services.claim(env.sid, 3)
  await env.services.claim(env.sid, 4)
  assert.equal(env.state.sessions.get(env.sid).subIds.length, 4)
})

test('sandbox seed file hands each seed to one session only', async () => {
  const env = makeEnv()
  const local = env.local
  const id = local.seedSubscription({ paidAt: env.clock.now() - 86_400_000 })
  env.state.clients.sandbox = local // pretend the stand-in is the sandbox so the seed file path runs
  env.services.seedFile.write([{ subscriptionId: id, createdAt: 'x' }])
  const other = '22222222-2222-4222-8222-222222222222'
  const results = await Promise.allSettled([env.services.claim(env.sid, 2), env.services.claim(other, 2)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /All sandbox subscriptions are in use/)
  assert.equal(env.services.poolStatus().ready, 0)
})
