import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { z } from 'zod'
import { runTool } from './tools.js'

// Recorded real model runs (scripts/recordRuns.js, LLM_BACKEND=account). In local mode, when the
// subscriber types one of the recorded sentences, the recorded tool calls are replayed in the same
// order against this subscription and the same server checks run on the recorded proposal.
// Nothing is invented: a sentence without a recording goes to the rule-based stand-in.
export const RECORDED_DIR = fileURLToPath(new URL('./recorded-runs/', import.meta.url))

const recordingSchema = z.object({
  id: z.string(),
  model: z.string(),
  modelLabel: z.string(),
  backend: z.literal('account'),
  recordedAt: z.string(),
  today: z.string(),
  scenario: z.number().int(),
  reason: z.string(),
  totalMs: z.number(),
  toolCalls: z.array(z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()).default({}), atMs: z.number(), ok: z.boolean(), summary: z.string().optional() })),
  proposal: z.object({ type: z.string(), weeks: z.number().optional(), return_hint: z.string().optional() }).nullable(),
  modelText: z.string().nullable(),
})

export const normalizeSentence = (text) => String(text || '').toLowerCase().replace(/[‘’]/g, "'").replace(/i'll/g, 'i will').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function loadRecordings(dir = RECORDED_DIR) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => recordingSchema.parse(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))))
}

let cache = null
const recordings = () => (cache ||= loadRecordings())

export function findRecording(reason, list = recordings()) {
  const key = normalizeSentence(reason)
  return list.find((r) => normalizeSentence(r.reason) === key) || null
}

export async function replayDecide(ctx, recording) {
  for (const call of recording.toolCalls) await runTool(ctx, call.tool, call.input)
  ctx.modelText = recording.modelText
  ctx.recorded = { id: recording.id, modelLabel: recording.modelLabel, model: recording.model, date: recording.recordedAt.slice(0, 10), today: recording.today, totalMs: recording.totalMs }
}
