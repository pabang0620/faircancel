import test from 'node:test'
import assert from 'node:assert/strict'
import { makeEnv } from './helpers.js'
import { createLiveLimits } from '../server/liveLimits.js'

const RECORDED = "Visiting family until mid-January, then I'll be back"
const liveConfig = (extra = {}) => ({ replayRecordedRuns: true, anthropicKey: 'sk-test', llmBackend: 'api', llmLiveUntil: Date.parse('2027-01-01T00:00:00Z'), ...extra })

// A fake model: counts calls, then either throws or does nothing (the proposal stays empty).
function fakeModel({ fail = false } = {}) {
  const fn = async () => { fn.calls += 1; if (fail) throw Object.assign(new Error('credit balance is too low'), { status: 400 }) }
  fn.calls = 0
  return fn
}

async function offerOn(env, reason, ip = '1.1.1.1', scenario = 1) {
  const sub = await env.services.claim(env.sid, scenario)
  return env.services.offer(env.sid, sub.id, reason, { ip })
}

test('liveLimits_hour_window_uses_the_clock_and_refusals_count_nothing', () => {
  const lim = createLiveLimits({ perIpHour: 2, perDay: 100 })
  const t0 = Date.parse('2026-11-13T00:00:00Z')
  assert.ok(lim.take('a', t0))
  assert.ok(lim.take('a', t0 + 1000))
  assert.equal(lim.take('a', t0 + 2000), false)
  assert.ok(lim.take('b', t0 + 2000), 'another IP has its own hour')
  assert.ok(lim.take('a', t0 + 3_600_000 + 1000), 'the first run left the window')
})

test('liveLimits_day_cap_is_per_host_across_ips_and_resets_after_a_day', () => {
  const lim = createLiveLimits({ perIpHour: 100, perDay: 3 })
  const t0 = Date.parse('2026-11-13T00:00:00Z')
  assert.ok(lim.take('a', t0) && lim.take('b', t0 + 1) && lim.take('c', t0 + 2))
  assert.equal(lim.take('d', t0 + 3), false)
  assert.ok(lim.take('d', t0 + 86_400_000 + 3))
})

test('live_model_error_falls_back_to_recorded_run_with_reason_and_no_raw_error', async () => {
  const env = makeEnv({ config: liveConfig() })
  env.state.liveDecide = fakeModel({ fail: true })
  const out = await offerOn(env, RECORDED)
  assert.equal(out.view.offer.decidedBy, 'recorded')
  assert.equal(out.view.offer.fallbackReason, 'live model unavailable')
  assert.doesNotMatch(JSON.stringify(out), /credit balance/)
})

test('live_model_error_on_unrecorded_sentence_uses_rule_based_stand_in', async () => {
  const env = makeEnv({ config: liveConfig() })
  env.state.liveDecide = fakeModel({ fail: true })
  const out = await offerOn(env, 'zzz unrecorded sentence about a move')
  assert.equal(out.view.offer.decidedBy, 'stand-in')
  assert.equal(out.view.offer.fallbackReason, 'live model unavailable')
})

test('per_ip_hour_cap_stops_live_calls_and_labels_live_limit_reached', async () => {
  const env = makeEnv({ config: liveConfig({ liveRunsPerIpHour: 1, liveRunsPerDay: 100 }) })
  const model = fakeModel()
  env.state.liveDecide = model
  const first = await offerOn(env, 'too expensive', '9.9.9.9')
  assert.equal(first.view.offer.fallbackReason, null)
  assert.equal(model.calls, 1)
  const second = await offerOn(env, RECORDED, '9.9.9.9')
  assert.equal(model.calls, 1, 'no second model call')
  assert.equal(second.view.offer.decidedBy, 'recorded')
  assert.equal(second.view.offer.fallbackReason, 'live limit reached')
  env.clock.advance(3_600_001)
  await offerOn(env, 'too expensive', '9.9.9.9')
  assert.equal(model.calls, 2, 'a new hour allows a live run again')
})

test('per_day_host_cap_applies_across_ips', async () => {
  const env = makeEnv({ config: liveConfig({ liveRunsPerIpHour: 100, liveRunsPerDay: 2 }) })
  const model = fakeModel()
  env.state.liveDecide = model
  await offerOn(env, 'too expensive', '1.1.1.1')
  await offerOn(env, 'too expensive', '2.2.2.2')
  const third = await offerOn(env, 'too expensive', '3.3.3.3')
  assert.equal(model.calls, 2)
  assert.equal(third.view.offer.fallbackReason, 'live limit reached')
  env.clock.advance(86_400_001)
  await offerOn(env, 'too expensive', '3.3.3.3')
  assert.equal(model.calls, 3)
})

test('live_caps_documented_in_readme_and_env_example', async () => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['README.md', '.env.example']) {
    const t = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    assert.match(t, /LLM_LIVE_PER_IP_HOUR/)
    assert.match(t, /LLM_LIVE_PER_DAY/)
  }
})
