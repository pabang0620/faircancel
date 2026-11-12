import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createApp } from '../server/app.js'

export const START = Date.parse('2026-11-12T20:00:00Z')

export function makeClock(start = START) {
  return { t: start, now() { return this.t }, advance(ms) { this.t += ms } }
}

export function makeEnv(overrides = {}) {
  const clock = makeClock()
  const config = {
    port: 0,
    dataDir: mkdtempSync(path.join(tmpdir(), 'faircancel-')),
    merchantName: 'Clay Studio',
    anthropicKey: '',
    anthropicModel: 'test',
    llmLiveUntil: 0,
    paypalClientId: '',
    paypalClientSecret: '',
    refundPath: 'v2capture',
    agentTimeoutMs: 6000,
    maxSeedsPerSession: 4,
    mockV2Refund: true,
    mockSuspendedCancel: true,
    ...overrides.config,
  }
  const built = createApp({ config, modes: { llm: 'mock', paypal: 'local' }, clock, sandbox: null, agent: overrides.agent })
  return { ...built, clock, config, sid: randomUUID(), local: built.state.clients.local }
}

export const callsOf = (env, subId, op) => env.state.activity.all().filter((a) => a.subscriptionId === subId && a.op === op && a.ok)
