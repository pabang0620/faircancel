import { ensureSession, iso, ownedSub } from './state.js'
import { claimSeed, poolStatus, createSeedFile, resetSession, scanSeeds, SCENARIOS } from './seedPool.js'
import { liveQuote, cancel, pause, resume, sync, runDueWork } from './cancelFlow.js'
import { requestOffer } from './offers.js'
import { llmBackendOf } from './agent/backend.js'
import { loadRecordings } from './agent/replayAgent.js'
import { RECORDED_CASES } from './agent/recordedCases.js'

let recordingList = null
const loadedRecordings = () => (recordingList ||= loadRecordings())
import { mockDecide } from './agent/mockAgent.js'
import { summarizeReasons } from './reasonSummary.js'
import { DAY_MS } from './refundCalc.js'

// Facade used by the HTTP routes and the tests. Every method takes the session that must own the subscription.
export function createServices(state, { seedFile = createSeedFile(null), agent = null } = {}) {
  const policyBlock = () => {
    const p = state.policyStore.get()
    return { merchantName: p.merchant.merchantName, setAt: p.setAt, pauseMenuWeeks: p.merchant.pauseMenuWeeks, refundMode: p.merchant.refundMode, fullRefundIfNoUsage: p.merchant.fullRefundIfNoUsage, stateRule: p.state, houseRules: p.house }
  }

  async function subscriberView(sub, { fresh = false } = {}) {
    let quote = null
    let quoteError = null
    if (sub.status !== 'CANCELLED') {
      try { quote = (await liveQuote(state, sub, { fresh })).public } catch (err) { quoteError = String(err.message).slice(0, 120) }
    } else quote = sub.result?.quote || null
    const paidAt = quote?.paidAt ? Date.parse(quote.paidAt) : null
    return {
      id: sub.id,
      backend: sub.backend,
      scenario: sub.scenario,
      status: sub.status,
      planName: 'Weekly class pass',
      priceLabel: '$9.00 per week',
      merchantName: state.config.merchantName,
      subscriberName: sub.subscriberName,
      paidAt: quote?.paidAt || null,
      nextCharge: sub.status === 'ACTIVE' && paidAt ? iso(state, paidAt + 7 * DAY_MS) : null,
      resumesAt: sub.status === 'SUSPENDED' && sub.resumeAt ? iso(state, sub.resumeAt) : null,
      cancelQuote: quote,
      quoteError,
      policy: { by: state.config.merchantName, setAt: state.policyStore.get().setAt },
      offer: sub.offer ? { ...sub.offer.shown, consumed: sub.offer.consumed, note: sub.offer.note, noteFrom: sub.offer.recorded ? `${sub.offer.recorded.modelLabel}, recorded ${sub.offer.recorded.date}` : null, decidedBy: sub.offer.source === 'agent' ? sub.offer.agentKind : sub.offer.source } : null,
      offerUsed: sub.offerRequested,
      pauseResult: sub.pauseResult,
      result: sub.result,
      cancelPending: !!sub.pendingCancel,
    }
  }

  // Says what really answers as "Agent": Claude only with a key inside the paid window, else the stand-in.
  const agentBlock = () => {
    const backend = llmBackendOf(state.config, state.clock.now())
    const recorded = backend === 'mock' && state.config.replayRecordedRuns ? loadedRecordings().map((r) => ({ reason: r.reason, scenario: r.scenario, step: RECORDED_CASES.find((c) => c.id === r.id)?.step ?? null, modelLabel: r.modelLabel, date: r.recordedAt.slice(0, 10) })) : []
    return { mode: backend === 'api' ? 'claude' : backend === 'account' ? 'claude-account' : 'stand-in', model: backend === 'mock' ? null : state.config.anthropicModel, recorded }
  }

  function merchantView(sessionId) {
    const session = ensureSession(state, sessionId)
    const subs = session.subIds.map((id) => state.subs.get(id))
    const ids = new Set(session.subIds)
    return {
      pool: poolStatus(state, seedFile),
      policy: policyBlock(),
      subscriptions: subs.map((s) => ({
        id: s.id, name: s.subscriberName, status: s.status, scenario: s.scenario, backend: s.backend,
        resumeAt: s.resumeAt ? iso(state, s.resumeAt) : null, lastSyncAt: s.lastSyncAt || null,
        usageCount: s.usageCount, refund: s.refund, reason: s.reason, lastSync: s.lastSync || null,
        refundState: s.result?.phase === 'refund_failed' ? 'failed' : s.pendingCancel ? 'retrying' : null,
        refundError: s.refundError || null,
      })),
      agent: agentBlock(),
      decisions: subs.filter((s) => s.offer).map((s) => ({ subscriptionId: s.id, reason: s.reason, rule: s.offer.rule, agent: s.offer.agent, agentKind: s.offer.agentKind, recorded: s.offer.recorded || null, agentLate: s.offer.agentLate, shown: s.offer.shown, source: s.offer.source, steps: s.offer.steps, shownAt: s.offer.shownAt })),
      activity: state.activity.forSubscriptions(ids).slice(-80),
      reasonSummary: summarizeReasons(subs),
    }
  }

  return {
    state,
    seedFile,
    poolStatus: () => poolStatus(state, seedFile),
    scanSeeds: () => scanSeeds(state, seedFile),
    policy: policyBlock,
    updatePolicy: (patch) => state.policyStore.update(patch),
    async claim(sessionId, scenario, allowLocal = false, { ip = null } = {}) {
      const sub = await claimSeed(state, seedFile, { sessionId, scenario, allowLocal, ip })
      return subscriberView(sub)
    },
    resetSession: (sessionId) => resetSession(state, seedFile, sessionId),
    async view(sessionId, subId, opts) { return subscriberView(ownedSub(state, sessionId, subId), opts) },
    async offer(sessionId, subId, reason, { forceMock = false } = {}) {
      const sub = ownedSub(state, sessionId, subId)
      const out = await requestOffer(state, sub, reason, { agent: forceMock ? mockDecide : agent })
      return { offer: out.offer, repeat: !!out.repeat, skipped: out.skipped || null, view: await subscriberView(sub) }
    },
    async pause(sessionId, subId) {
      const sub = ownedSub(state, sessionId, subId)
      await pause(state, sub)
      return subscriberView(sub)
    },
    async resume(sessionId, subId) {
      const sub = ownedSub(state, sessionId, subId)
      await resume(state, sub)
      return subscriberView(sub)
    },
    async cancel(sessionId, subId, reason) {
      const sub = ownedSub(state, sessionId, subId)
      await cancel(state, sub, reason)
      return subscriberView(sub)
    },
    async sync(sessionId, subId) {
      const sub = ownedSub(state, sessionId, subId)
      const out = await sync(state, sub)
      return { sync: out, view: await subscriberView(sub, { fresh: true }) }
    },
    // Webhook payloads are only a hint: we re-read the subscription from PayPal.
    async applyWebhook(event) {
      const id = event?.resource?.id || event?.resource?.billing_agreement_id
      const sub = id ? state.subs.get(id) : null
      if (!sub) return { handled: false }
      await sync(state, sub)
      return { handled: true, subscriptionId: sub.id }
    },
    merchantView,
    runDueWork: () => runDueWork(state),
    scenarios: SCENARIOS,
  }
}
