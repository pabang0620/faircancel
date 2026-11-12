// Records real model runs for the README sentences through the local Claude Code account
// (LLM_BACKEND=account path, never an API key). RUN BY A PERSON. PayPal stays on the local stand-in.
// Writes server/agent/recorded-runs/<id>.json: tool calls in order with inputs and arrival times,
// the model's final text, its proposal and the wall time. Local mode replays these files.
//   node scripts/recordRuns.js            record every case
//   node scripts/recordRuns.js hero_b     record one case
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createApp } from '../server/app.js'
import { config } from '../server/config.js'
import { createToolContext } from '../server/agent/tools.js'
import { accountDecide } from '../server/agent/accountAgent.js'
import { RECORDED_DIR } from '../server/agent/replayAgent.js'

delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN

const MODEL_LABEL = 'Claude Sonnet'
const cfg = { ...config, llmBackend: 'account', anthropicKey: '', paypalClientId: '', paypalClientSecret: '', llmLiveUntil: Infinity, agentTimeoutMs: 120_000, replayRecordedRuns: false }
const { services } = createApp({ config: cfg, modes: { llm: 'account', paypal: 'local' }, clock: { now: () => Date.now() }, sandbox: null })

// The exact sentences of the README "Try it" steps.
const CASES = [
  { id: 'step2_too_expensive', scenario: 2, reason: 'too expensive' },
  { id: 'step3_hero_a', scenario: 1, reason: "Visiting family until mid-January, then I'll be back" },
  { id: 'step4_hero_b', scenario: 1, reason: 'Back after the holidays, my kid is home' },
  { id: 'step5_billing', scenario: 3, reason: "I was charged yesterday but couldn't make any class this week" },
]

async function record(c) {
  const sid = `record-${c.id}-${Date.now()}`
  const view = await services.claim(sid, c.scenario, true)
  const sub = services.state.subs.get(view.id)
  const ctx = createToolContext({ state: services.state, sub, reason: c.reason })
  const started = Date.now()
  await accountDecide(ctx, { model: cfg.anthropicModel })
  const totalMs = Date.now() - started
  const out = {
    id: c.id,
    model: cfg.anthropicModel,
    modelLabel: MODEL_LABEL,
    backend: 'account',
    recordedAt: new Date(started).toISOString(),
    today: new Date(started).toISOString().slice(0, 10),
    scenario: c.scenario,
    reason: c.reason,
    totalMs,
    toolCalls: ctx.calls.map((s) => ({ tool: s.tool, input: s.input || {}, atMs: s.atMs, ok: s.ok, summary: s.summary || '' })),
    proposal: ctx.proposal,
    modelText: ctx.modelText || null,
  }
  mkdirSync(RECORDED_DIR, { recursive: true })
  writeFileSync(path.join(RECORDED_DIR, `${c.id}.json`), `${JSON.stringify(out, null, 2)}\n`)
  return { id: c.id, totalMs, tools: out.toolCalls.map((t) => t.tool).join(' -> '), proposal: out.proposal }
}

const only = process.argv[2]
for (const c of CASES.filter((x) => !only || x.id === only)) {
  try {
    process.stdout.write(`${JSON.stringify(await record(c))}\n`)
  } catch (err) {
    process.stderr.write(`${c.id} failed: ${err.message}\n`)
    process.exitCode = 1
  }
}
