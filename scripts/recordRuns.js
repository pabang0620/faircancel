// Records real model runs for the sentences in server/agent/recordedCases.js through the local Claude Code
// account (LLM_BACKEND=account path, never an API key). RUN BY A PERSON. PayPal stays on the local stand-in.
// Writes server/agent/recorded-runs/<id>.json: tool calls in order with inputs and arrival times,
// the model's final text, its proposal and the wall time. Local mode replays these files.
// Each sentence is recorded once: a case that already has a file is skipped, so no sentence is recorded
// again to get a better answer. Delete a file by hand to record that case again.
//   node scripts/recordRuns.js                 record every case that has no file yet
//   node scripts/recordRuns.js step4_hero_b    record one case (only if it has no file yet)
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createApp } from '../server/app.js'
import { config } from '../server/config.js'
import { createToolContext } from '../server/agent/tools.js'
import { accountDecide } from '../server/agent/accountAgent.js'
import { RECORDED_DIR } from '../server/agent/replayAgent.js'
import { RECORDED_CASES } from '../server/agent/recordedCases.js'

delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN

const MODEL_LABEL = 'Claude Sonnet'
const cfg = { ...config, llmBackend: 'account', anthropicKey: '', paypalClientId: '', paypalClientSecret: '', llmLiveUntil: Infinity, agentTimeoutMs: 120_000, replayRecordedRuns: false }
const { services } = createApp({ config: cfg, modes: { llm: 'account', paypal: 'local' }, clock: { now: () => Date.now() }, sandbox: null })

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
for (const c of RECORDED_CASES.filter((x) => !only || x.id === only)) {
  if (existsSync(path.join(RECORDED_DIR, `${c.id}.json`))) {
    process.stdout.write(`${c.id}: already recorded, skipped\n`)
    continue
  }
  try {
    process.stdout.write(`${JSON.stringify(await record(c))}\n`)
  } catch (err) {
    process.stderr.write(`${c.id} failed: ${err.message}\n`)
    process.exitCode = 1
  }
}
