// Model checks through the local Claude Code account (LLM_BACKEND=account path). RUN BY A PERSON.
// PayPal stays on the local stand-in: no PayPal call is made. ANTHROPIC_API_KEY is removed before anything runs.
//   node scripts/verifyModel.js            each scenario once, prints one JSON line per scenario
//   node scripts/verifyModel.js --latency  adds 3 timed runs of the hero sentence (C1)
import { createApp } from '../server/app.js'
import { config } from '../server/config.js'

delete process.env.ANTHROPIC_API_KEY
delete process.env.ANTHROPIC_AUTH_TOKEN

const cfg = { ...config, llmBackend: 'account', anthropicKey: '', paypalClientId: '', paypalClientSecret: '', llmLiveUntil: Infinity, agentTimeoutMs: 120_000 }
const { services } = createApp({ config: cfg, modes: { llm: 'account', paypal: 'local' }, clock: { now: () => Date.now() }, sandbox: null })

const CASES = [
  { id: 'hero_a', scenario: 1, reason: 'Visiting family until mid-January, then I will be back' },
  { id: 'hero_b', scenario: 1, reason: 'Back after the holidays, my kid is home' },
  { id: 'billing', scenario: 3, reason: "I was charged yesterday but couldn't make any class this week" },
  { id: 'too_expensive', scenario: 2, reason: 'too expensive' },
]

async function runCase(c, n) {
  const sid = `verify-${c.id}-${n}-${Date.now()}`
  const sub = await services.claim(sid, c.scenario, true)
  const started = Date.now()
  await services.offer(sid, sub.id, c.reason)
  const ms = Date.now() - started
  const d = services.merchantView(sid).decisions[0]
  return { case: c.id, reason: c.reason, ms, within6s: ms <= 6000, agentKind: d.agentKind, rule: d.rule, agent: d.agent, shown: d.shown, tools: d.steps.map((s) => s.tool).join(' -> ') }
}

const results = []
for (const c of CASES) results.push(await runCase(c, 1))
if (process.argv.includes('--latency')) for (let i = 2; i <= 4; i += 1) results.push(await runCase(CASES[1], i))
for (const r of results) process.stdout.write(`${JSON.stringify(r)}\n`)
