import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeEnv } from './helpers.js'
import { claudeDecide } from '../server/agent/claudeAgent.js'
import { accountDecide, envWithoutApiKey } from '../server/agent/accountAgent.js'
import { createToolContext } from '../server/agent/tools.js'
import { llmBackendOf } from '../server/agent/backend.js'
import { parseReturnHint } from '../server/returnHint.js'
import { quoteRefund } from '../server/refundCalc.js'
import { orderDecisions, subRowClass, decisionClass, activityClass } from '../client/src/panelOrder.js'

const DAY = 86_400_000
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

// A scripted stand-in for the Anthropic messages API, so no network is touched.
function scriptedClaude(steps) {
  let i = 0
  return async () => {
    const step = steps[i]
    i += 1
    return { stop_reason: step.stop ? 'end_turn' : 'tool_use', content: step.stop ? [{ type: 'text', text: step.stop }] : [{ type: 'tool_use', id: `t${i}`, name: step.name, input: step.input || {} }] }
  }
}

function claudeAgent(steps) {
  const agent = (ctx) => claudeDecide(ctx, { model: 'test', complete: scriptedClaude(steps) })
  agent.kind = 'claude'
  return agent
}

const HOLIDAYS = 'Back after the holidays, my kid is home'

test('agent_reads_return_time_regex_cannot', async () => {
  assert.equal(parseReturnHint(HOLIDAYS, Date.parse('2026-11-12T20:00:00Z')), null, 'keywords cannot read this sentence')
  const env = makeEnv({ agent: claudeAgent([
    { name: 'get_policy' },
    { name: 'get_subscription_state' },
    { name: 'propose_offer', input: { type: 'pause', weeks: 6, return_hint: 'after the holidays' } },
    { stop: 'Pause fits.' },
  ]) })
  const v = await env.services.claim(env.sid, 1)
  const out = await env.services.offer(env.sid, v.id, HOLIDAYS)
  const decision = env.services.merchantView(env.sid).decisions[0]
  assert.deepEqual(decision.rule, { type: 'pause', weeks: 2, source: 'rule' })
  assert.equal(decision.agentKind, 'claude')
  assert.equal(decision.agent.weeks, 6, 'the model value is not overwritten by a server regex')
  assert.equal(decision.agent.returnHint, 'after the holidays')
  assert.equal(out.offer.weeks, 6)
  assert.equal(decision.steps.map((s) => s.tool).join(','), 'get_policy,get_subscription_state,propose_offer')
})

test('model_output_is_validated_by_the_server', async () => {
  const cases = [
    { weeks: 3, hint: 'after the holidays', dropped: 'outside_policy_menu' },
    { weeks: 52, hint: 'after the holidays', dropped: 'outside_policy_menu' },
  ]
  for (const c of cases) {
    const env = makeEnv({ agent: claudeAgent([{ name: 'propose_offer', input: { type: 'pause', weeks: c.weeks, return_hint: c.hint } }, { stop: 'x' }]) })
    const v = await env.services.claim(env.sid, 1)
    await env.services.offer(env.sid, v.id, HOLIDAYS)
    const d = env.services.merchantView(env.sid).decisions[0]
    assert.equal(d.agent.type, 'none')
    assert.equal(d.agent.dropped, c.dropped)
  }
  const env = makeEnv({ agent: claudeAgent([{ name: 'propose_offer', input: { type: 'pause', weeks: 4, return_hint: 'my doctor said six weeks' } }, { stop: 'x' }]) })
  const v = await env.services.claim(env.sid, 1)
  await env.services.offer(env.sid, v.id, HOLIDAYS)
  const d = env.services.merchantView(env.sid).decisions[0]
  assert.equal(d.agent.weeks, 4)
  assert.equal(d.agent.returnHint, null, 'a hint that is not in the subscriber words is dropped')
  const discount = makeEnv({ agent: claudeAgent([{ name: 'propose_offer', input: { type: 'discount', weeks: 4 } }, { stop: 'x' }]) })
  const w = await discount.services.claim(discount.sid, 1)
  await discount.services.offer(discount.sid, w.id, HOLIDAYS)
  assert.equal(discount.services.merchantView(discount.sid).decisions[0].agent.dropped, 'type_not_allowed')
})

test('stand_in_gives_the_rule_value_on_a_sentence_keywords_cannot_read', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 1)
  await env.services.offer(env.sid, v.id, HOLIDAYS)
  const d = env.services.merchantView(env.sid).decisions[0]
  assert.equal(d.agentKind, 'stand-in')
  assert.equal(d.agent.weeks, d.rule.weeks, 'no hidden model: the stand-in honestly matches the rule card')
  assert.equal(d.agent.returnHint, null)
})

test('account_adapter_strips_api_key_and_maps_tool_calls', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 1)
  const sub = env.state.subs.get(v.id)
  const ctx = createToolContext({ state: env.state, sub, reason: HOLIDAYS })
  let options = null
  let prompt = ''
  const sdk = {
    tool: (name, description, shape, handler) => ({ name, description, shape, handler }),
    createSdkMcpServer: (spec) => spec,
    query: (args) => {
      options = args.options
      prompt = args.prompt
      return (async function* run() {
        const tools = options.mcpServers.faircancel.tools
        const call = (name, input) => tools.find((t) => t.name === name).handler(input)
        const policy = await call('get_policy', {})
        assert.equal(policy.isError, false)
        await call('propose_offer', { type: 'pause', weeks: 4, return_hint: 'after the holidays' })
        yield { type: 'result', subtype: 'success', result: 'Pause fits.' }
      })()
    },
  }
  await accountDecide(ctx, { model: 'claude-sonnet-5-5', sdk, env: { ANTHROPIC_API_KEY: 'sk-secret', ANTHROPIC_AUTH_TOKEN: 'tok', HOME: '/h' } })
  assert.equal(options.env.ANTHROPIC_API_KEY, undefined)
  assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(options.env.HOME, '/h')
  assert.deepEqual(options.settingSources, [])
  assert.equal(options.model, 'claude-sonnet-5-5')
  assert.match(prompt, /Today is 2026-11-12/)
  assert.deepEqual(ctx.calls.map((c) => c.tool), ['get_policy', 'propose_offer'])
  assert.deepEqual(ctx.proposal, { type: 'pause', weeks: 4, return_hint: 'after the holidays' })
  assert.equal(ctx.modelText, 'Pause fits.')
  assert.equal('ANTHROPIC_API_KEY' in envWithoutApiKey({ ANTHROPIC_API_KEY: 'x', A: '1' }), false)
})

test('backend_defaults_to_mock_and_tests_force_mock', () => {
  const live = Date.parse('2030-01-01')
  assert.equal(llmBackendOf({ llmLiveUntil: live }, 0), 'mock')
  assert.equal(llmBackendOf({ llmLiveUntil: live, anthropicKey: 'k' }, 0), 'api')
  assert.equal(llmBackendOf({ llmLiveUntil: live, llmBackend: 'account', anthropicKey: '' }, 0), 'account')
  assert.equal(llmBackendOf({ llmLiveUntil: live, llmBackend: 'account' }, live + 1), 'mock', 'never after the live window')
  assert.equal(llmBackendOf({ llmLiveUntil: live, llmBackend: 'mock', anthropicKey: 'k' }, 0), 'mock')
  assert.match(JSON.parse(read('package.json')).scripts.test, /FORCE_MOCK=1 LLM_BACKEND=mock/)
  const env = makeEnv({ config: { llmBackend: 'account', llmLiveUntil: live } })
  assert.equal(env.services.merchantView(env.sid).agent.mode, 'claude-account')
  assert.match(read('client/src/components/MerchantPanel.jsx'), /Claude Sonnet \(local account/)
})

test('full_refund_text_uses_capped_amount', () => {
  const policy = { fullRefundIfNoUsage: true, refundMode: 'prorate' }
  const paidAt = Date.parse('2026-11-12T00:00:00Z')
  const txn = (refundedCents) => [{ status: 'COMPLETED', id: 'T1', amount_with_breakdown: { gross_amount: { value: '9.00' } }, time: new Date(paidAt).toISOString(), refundedCents }]
  const clean = quoteRefund({ transactions: txn(0), usageCount: 0, now: paidAt + DAY, policy })
  assert.equal(clean.cents, 900)
  assert.match(clean.formula, /the full \$9\.00 goes back/)
  const capped = quoteRefund({ transactions: txn(1), usageCount: 0, now: paidAt + DAY, policy })
  assert.equal(capped.cents, 899)
  assert.match(capped.formula, /\$8\.99 goes back/)
  assert.doesNotMatch(capped.formula, /the full \$9\.00/)
})

test('ready_count_excludes_cancelled_seeds', async () => {
  const env = makeEnv()
  const good = env.local.seedSubscription({ paidAt: env.clock.now() - DAY })
  const cancelled = env.local.seedSubscription({ paidAt: env.clock.now() - DAY })
  env.local.buyerCancelsAtPayPal(cancelled)
  env.state.clients.sandbox = env.local
  env.services.seedFile.write([good, cancelled].map((id) => ({ subscriptionId: id })))
  assert.equal(env.services.poolStatus().ready, 2, 'before the scan both look ready')
  const scan = await env.services.scanSeeds()
  assert.deepEqual(scan, { checked: 2, bad: 1 })
  assert.equal(env.services.poolStatus().ready, 1)
})

test('merchant_panel_shows_latest_decision_first', () => {
  const ordered = orderDecisions([
    { subscriptionId: 'a', shownAt: '2026-11-12T10:00:00Z' },
    { subscriptionId: 'c', shownAt: '2026-11-12T10:05:00Z' },
    { subscriptionId: 'b', shownAt: '2026-11-12T10:02:00Z' },
  ])
  assert.deepEqual(ordered.map((d) => d.subscriptionId), ['c', 'b', 'a'])
  const panel = read('client/src/components/MerchantPanel.jsx')
  assert.ok(panel.indexOf('How FairCancel decided') < panel.indexOf('<h3>Activity</h3>'), 'decision card sits above Activity')
  assert.match(panel, /orderDecisions\(data\.decisions\)/)
})

test('current_subscription_row_is_highlighted', () => {
  assert.match(subRowClass({ id: 's1' }, 's1'), /--current/)
  assert.doesNotMatch(subRowClass({ id: 's2' }, 's1'), /--current/)
  assert.match(decisionClass({ subscriptionId: 's1' }, 's1'), /--current/)
  assert.match(activityClass({ ok: true, subscriptionId: 's2' }, 's1'), /activity--dim/)
  assert.equal(activityClass({ ok: true, subscriptionId: 's1' }, 's1'), '')
  assert.equal(activityClass({ ok: true, subscriptionId: 's2' }, null), '')
})

test('local_mode_activity_and_transaction_ids_are_not_paypal_shaped', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 2)
  await env.services.cancel(env.sid, v.id, '')
  const view = env.services.merchantView(env.sid)
  const refundCall = view.activity.find((a) => a.op === 'refundCapture')
  assert.match(refundCall.path, /\/captures\/MOCK-TXN-[A-Z0-9]+\/refund$/)
  assert.match(refundCall.ref, /^MOCK-REFUND-/)
  for (const a of view.activity.filter((x) => /captures/.test(x.path))) assert.doesNotMatch(a.path, /captures\/[A-Z0-9]{17}\//)
})

test('film_mode_shows_sandbox_badge_and_copyable_ids', () => {
  assert.match(read('client/src/components/JudgePage.jsx'), /film/)
  assert.match(read('client/src/components/JudgePage.jsx'), /PayPal SANDBOX/)
  assert.match(read('client/src/components/MerchantPanel.jsx'), /clipboard/)
})

test('seed_scripts_read_buyer_login_from_the_environment_first', () => {
  const py = read('scripts/approveSeeds.py')
  assert.ok(py.indexOf("os.environ.get('SANDBOX_BUYER_EMAIL')") < py.indexOf('from_env_file(\'SANDBOX_BUYER_EMAIL\')'))
  const sh = read('scripts/topUpSeeds.sh')
  assert.match(sh, /SANDBOX_BUYER_EMAIL:\?/)
  assert.match(sh, /seedLive\.js create/)
  assert.match(sh, /approveSeeds\.py/)
  assert.match(sh, /seedLive\.js collect/)
})
