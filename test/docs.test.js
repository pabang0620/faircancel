import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadRecordings } from '../server/agent/replayAgent.js'
import { RECORDED_CASES } from '../server/agent/recordedCases.js'
import { parseReturnHint } from '../server/returnHint.js'
import { validateProposal } from '../server/offers.js'
import { runTool, createToolContext } from '../server/agent/tools.js'
import { makeEnv } from './helpers.js'
import { quoteRefund, DAY_MS } from '../server/refundCalc.js'

// The docs quote what the screen shows. These tests tie each quote to the code that produces it, so a
// change in the code fails here instead of leaving an old example in the README (REVIEW_5 F8, F9, F11).

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const DOCS = ['README.md', 'DEVPOST.md', 'VERIFY.md', 'BUILD_REPORT.md', 'docs/VIDEO_SCRIPT.md']
const SCREEN_DOCS = ['README.md', 'DEVPOST.md', 'docs/VIDEO_SCRIPT.md']
const MENU = [2, 4, 6, 8]

// What the subscriber card shows for a recorded sentence on the day it was recorded.
function serverResult(r) {
  return validateProposal(r.proposal, { menu: MENU, reason: r.reason, now: Date.parse(r.recordedAt) })
}

test('docs_do_not_hard_code_a_test_count', () => {
  // Lower case on purpose: "| 10 Tests |" in the video script is a scene name, not a count.
  const count = /\b\d+\s+(?:automated\s+|new\s+|unit\s+)?tests?\b|\btests?\s*[:=]\s*\d+\b|\b\d+\s*\/\s*\d+\s+pass|#\s*(?:tests|pass)\s+\d+/
  for (const file of DOCS) {
    const hit = read(file).split('\n').find((line) => count.test(line))
    assert.equal(hit, undefined, `${file} hard-codes a test count: ${hit}`)
  }
})

test('every_you_said_quote_in_the_docs_is_one_the_server_produces', () => {
  const recordings = loadRecordings()
  const produced = new Set()
  for (const r of recordings) {
    const shown = serverResult(r)
    if (shown.returnHint) produced.add(shown.returnHint)
    const hint = parseReturnHint(r.reason, Date.parse(r.recordedAt))
    if (hint) produced.add(hint.hint)
  }
  for (const file of SCREEN_DOCS) {
    for (const m of read(file).matchAll(/\(you said ([^)]*)\)/g)) {
      const quote = m[1].trim()
      if (quote.includes('...') || quote.includes('{')) continue
      assert.ok(produced.has(quote), `${file}: "(you said ${quote})" is not what the screen shows (server gives: ${[...produced].join(' | ')})`)
    }
  }
})

test('readme_recorded_runs_table_matches_the_recordings', () => {
  const readme = read('README.md')
  const rows = readme.split('\n').filter((l) => /^\| (\d|-) \| /.test(l))
  const recordings = loadRecordings()
  assert.equal(rows.length, RECORDED_CASES.length, 'one row per recorded sentence')
  for (const c of RECORDED_CASES) {
    const r = recordings.find((x) => x.id === c.id)
    const row = rows.find((l) => l.startsWith(`| ${c.step ?? '-'} | ${c.reason} |`))
    assert.ok(row, `README row for "${c.reason}"`)
    const [, , codeReads, tools, pick, result, time] = row.split('|').slice(1, -1).map((x) => x.trim())
    const hint = parseReturnHint(c.reason, Date.parse(r.recordedAt))
    assert.equal(codeReads, hint ? `yes ("${hint.hint}")` : 'no')
    assert.equal(tools, r.toolCalls.map((t) => t.tool).join(', '))
    assert.equal(pick, r.proposal.type === 'pause' ? `pause ${r.proposal.weeks} weeks` : 'no offer')
    const shown = serverResult(r)
    assert.equal(result, shown.type === 'pause' ? `pause ${shown.weeks} weeks${shown.returnHint ? ` (you said ${shown.returnHint})` : ''}` : 'no offer')
    assert.equal(time, `${(r.totalMs / 1000).toFixed(1)} s`)
  }
})

test('formula_examples_in_the_docs_are_what_the_code_computes', () => {
  const policy = { refundMode: 'prorate', fullRefundIfNoUsage: true }
  let seen = 0
  for (const file of SCREEN_DOCS) {
    for (const m of read(file).matchAll(/\$9\.00 x (\d\.\d\d?) of 7(?: days unused)? = \$(\d+\.\d\d)/g)) {
      // A payment made just under (7 - unused) days ago leaves exactly that many unused days, to two decimals.
      const unused = Number(m[1])
      const now = Date.parse('2026-11-12T20:00:00Z')
      const time = new Date(now - Math.round((7 - unused) * DAY_MS) + 1000).toISOString()
      const q = quoteRefund({ transactions: [{ id: 'T', status: 'COMPLETED', amount_with_breakdown: { gross_amount: { currency_code: 'USD', value: '9.00' } }, time }], usageCount: 1, now, policy })
      assert.equal(q.formula, `$9.00 x ${m[1]} of 7 days unused = $${m[2]}`, `${file}: "${m[0]}"`)
      seen += 1
    }
  }
  assert.ok(seen > 0, 'the docs show at least one formula')
})

test('tool_summaries_pluralise_counts', async () => {
  const env = makeEnv()
  const v = await env.services.claim(env.sid, 3)
  const sub = env.state.subs.get(v.id)
  const ctx = createToolContext({ state: env.state, sub, reason: 'charged' })
  await runTool(ctx, 'list_recent_payments')
  await runTool(ctx, 'get_usage_record')
  const [payments, usage] = ctx.calls.map((c) => c.summary)
  assert.match(payments, /^1 payment$/, 'a new subscription has one payment')
  assert.equal(usage, '0 classes this week')
  sub.usageCount = 1
  await runTool(ctx, 'get_usage_record')
  assert.equal(ctx.calls.at(-1).summary, '1 class this week')
  for (const r of loadRecordings()) for (const t of r.toolCalls) assert.doesNotMatch(t.summary || '', /\b1 (payments|classes)\b/, `${r.id} stored summary`)
})
