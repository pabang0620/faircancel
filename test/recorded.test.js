import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEnv, makeClock } from './helpers.js'
import { loadRecordings, findRecording } from '../server/agent/replayAgent.js'
import { TOOL_DEFS } from '../server/agent/tools.js'
import { readFileSync } from 'node:fs'
import { SANDBOX_EVIDENCE } from '../client/src/sandboxEvidence.js'
import { RECORDED_CASES } from '../server/agent/recordedCases.js'
import { parseReturnHint } from '../server/returnHint.js'

const README_SENTENCES = [
  'too expensive',
  "Visiting family until mid-January, then I'll be back",
  'Back after the holidays, my kid is home',
  "I was charged yesterday but couldn't make any class this week",
]
const HOLIDAYS = README_SENTENCES[2]
const TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.name))

test('recorded_runs_are_real_account_runs_for_every_case', () => {
  const list = loadRecordings()
  assert.equal(list.length, RECORDED_CASES.length, 'one file per case, no stray recordings')
  assert.deepEqual(RECORDED_CASES.filter((c) => c.step).map((c) => c.reason), README_SENTENCES)
  for (const c of RECORDED_CASES) {
    const sentence = c.reason
    const r = findRecording(sentence, list)
    assert.ok(r, `a recording exists for "${sentence}"`)
    assert.equal(r.id, c.id)
    assert.equal(r.reason, sentence, 'recorded with the exact case sentence')
    assert.equal(r.backend, 'account')
    assert.equal(r.modelLabel, 'Claude Sonnet')
    assert.ok(r.totalMs > 0)
    assert.ok(r.toolCalls.every((c) => TOOL_NAMES.has(c.tool)), 'only the seven read-only tools')
    assert.equal(r.toolCalls.at(-1).tool, 'propose_offer', 'the model finishes with propose_offer')
    assert.ok(r.toolCalls.every((c, i) => i === 0 || c.atMs >= r.toolCalls[i - 1].atMs), 'tool calls in arrival order')
  }
})

test('local_mode_replays_the_recorded_run_with_its_label', async () => {
  const env = makeEnv({ config: { replayRecordedRuns: true } })
  const v = await env.services.claim(env.sid, 1)
  const out = await env.services.offer(env.sid, v.id, 'back after the holidays, my kid is home!')
  const d = env.services.merchantView(env.sid).decisions[0]
  assert.equal(d.agentKind, 'recorded')
  assert.equal(d.recorded.modelLabel, 'Claude Sonnet')
  assert.equal(d.recorded.date, '2026-11-12')
  assert.deepEqual(d.rule, { type: 'pause', weeks: 2, source: 'rule' })
  assert.equal(d.agent.weeks, 8, 'the recorded model pick, checked by the server')
  assert.equal(d.steps.map((s) => s.tool).join(','), findRecording(HOLIDAYS).toolCalls.map((c) => c.tool).join(','))
  assert.match(out.view.offer.noteFrom, /Claude Sonnet, recorded 2026-11-12/)
  assert.equal(env.services.merchantView(env.sid).agent.recorded.length, RECORDED_CASES.length)
})

test('a_sentence_without_a_recording_goes_to_the_stand_in_and_the_subscriber_is_told', async () => {
  const env = makeEnv({ config: { replayRecordedRuns: true } })
  const v = await env.services.claim(env.sid, 1)
  const out = await env.services.offer(env.sid, v.id, 'Taking exams, back in about 4 weeks')
  const d = env.services.merchantView(env.sid).decisions[0]
  assert.equal(d.agentKind, 'stand-in')
  assert.equal(d.recorded, null)
  assert.equal(out.view.offer.decidedBy, 'stand-in', 'the subscriber card says the stand-in read it')
  const offerCard = read('client/src/components/OfferCard.jsx')
  assert.match(offerCard, /decidedBy === 'stand-in'/)
  assert.match(offerCard, /no recorded run/)
})

test('a_recorded_sentence_is_labelled_recorded_on_the_subscriber_side', async () => {
  const env = makeEnv({ config: { replayRecordedRuns: true } })
  const v = await env.services.claim(env.sid, 1)
  const out = await env.services.offer(env.sid, v.id, 'When school starts again I will come back')
  assert.equal(out.view.offer.decidedBy, 'recorded')
  assert.match(out.view.offer.noteFrom, /Claude Sonnet, recorded 2026-11-12/)
})

// ---- A2: every recorded sentence replays through the same server checks ----

const MENU = [2, 4, 6, 8]

for (const c of RECORDED_CASES) {
  test(`replay_${c.id}_passes_the_server_checks`, async () => {
    const r = findRecording(c.reason)
    const env = makeEnv({ config: { replayRecordedRuns: true } })
    env.clock.t = Date.parse(r.recordedAt)
    const v = await env.services.claim(env.sid, c.scenario)
    const out = await env.services.offer(env.sid, v.id, c.reason)
    const d = env.services.merchantView(env.sid).decisions[0]
    assert.equal(d.agentKind, 'recorded')
    assert.equal(d.steps.map((s) => s.tool).join(','), r.toolCalls.map((t) => t.tool).join(','), 'same tools, same order')
    const shown = out.view.offer
    assert.ok(shown.type === 'none' || (shown.type === 'pause' && MENU.includes(shown.weeks)), 'menu value or no offer')
    if (shown.returnHint) assert.ok(c.reason.toLowerCase().includes(shown.returnHint.toLowerCase()), 'quote is the subscriber\'s own words')
    // Where code reads a return time, the server's snap decides; otherwise the model's menu value stands.
    if (r.proposal.type === 'pause' && !parseReturnHint(c.reason, env.clock.t)) assert.equal(shown.weeks, r.proposal.weeks)
    if (r.proposal.type === 'none') assert.equal(shown.type, 'none')
  })
}

test('recorded_set_is_mostly_sentences_code_cannot_read', () => {
  const extras = RECORDED_CASES.filter((c) => !c.step)
  assert.ok(extras.length >= 10)
  const unreadablePauses = extras.filter((c) => {
    const r = findRecording(c.reason)
    return r.proposal.type === 'pause' && !parseReturnHint(c.reason, Date.parse(r.recordedAt))
  })
  assert.ok(unreadablePauses.length >= 4, 'the model, not a regex, reads the return time in these')
  assert.ok(extras.some((c) => findRecording(c.reason).proposal.type === 'none'), 'and some are not pauses at all')
})

test('replayed_proposal_is_still_snapped_by_the_server_and_its_text_dropped', async () => {
  const env = makeEnv({ config: { replayRecordedRuns: true } })
  env.clock.t = makeClock(Date.parse('2026-12-15T20:00:00Z')).t
  const v = await env.services.claim(env.sid, 1)
  const out = await env.services.offer(env.sid, v.id, README_SENTENCES[1])
  const d = env.services.merchantView(env.sid).decisions[0]
  assert.equal(d.agentKind, 'recorded')
  assert.equal(d.agent.snappedFrom, 8, 'recorded on Nov 12, re-snapped to today by the server')
  assert.notEqual(d.agent.weeks, 8)
  assert.equal(out.view.offer.note, null, 'the recorded words would disagree with the card, so they are not shown')
})

test('replay_is_never_used_when_a_model_is_configured', async () => {
  const env = makeEnv({ config: { replayRecordedRuns: true, llmLiveUntil: Infinity, llmBackend: 'api', anthropicKey: 'x' } })
  assert.equal(env.services.merchantView(env.sid).agent.mode, 'claude')
  assert.deepEqual(env.services.merchantView(env.sid).agent.recorded, [])
})

// ---- C6: the in-app evidence panel claims only PASS rows of VERIFY.md ----

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('sandbox_evidence_panel_lists_only_pass_rows_of_verify', () => {
  const verify = read('VERIFY.md')
  for (const e of SANDBOX_EVIDENCE) {
    const row = verify.split('\n').find((l) => l.startsWith(`| ${e.id} |`))
    assert.ok(row, `${e.id} is a VERIFY row`)
    const result = row.split('|').filter(Boolean).at(-1).trim()
    assert.match(result, /^PASS/, `${e.id} is PASS in VERIFY.md`)
  }
  for (const open of ['S7', 'V13', 'V14']) assert.ok(!SANDBOX_EVIDENCE.some((e) => e.id === open))
})

// ---- C5: README, DEVPOST and the video script use the same steps and sentences ----

test('readme_devpost_and_video_script_share_the_step_sentences', () => {
  const docs = ['README.md', 'DEVPOST.md', 'docs/VIDEO_SCRIPT.md'].map(read)
  for (const sentence of README_SENTENCES) for (const [i, d] of docs.entries()) assert.ok(d.includes(sentence), `doc ${i} has "${sentence}"`)
  const times = [...docs[2].matchAll(/\| (\d):(\d\d)-(\d):(\d\d) \|/g)].map((m) => Number(m[3]) * 60 + Number(m[4]))
  assert.ok(times.length >= 8)
  assert.ok(Math.max(...times) < 170, 'the video is under 2:50')
  for (const d of docs) assert.doesNotMatch(d, /\u2014|TODO|FILL|\bCHECK\b/)
})
