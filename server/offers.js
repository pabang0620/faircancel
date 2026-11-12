import { HttpError } from './http.js'
import { iso } from './state.js'
import { ruleCard, parseReturnHint, pauseWeeksFor } from './returnHint.js'
import { createToolContext, sanitizeModelText } from './agent/tools.js'
import { mockDecide } from './agent/mockAgent.js'
import { claudeDecide } from './agent/claudeAgent.js'
import { accountDecide } from './agent/accountAgent.js'
import { llmBackendOf } from './agent/backend.js'
import { findRecording, replayDecide } from './agent/replayAgent.js'
import { isOutage } from './fallback.js'

// Checks an agent proposal against the policy. Anything outside the menu or not a pause is dropped.
export function validateProposal(proposal, { menu, reason, now }) {
  if (!proposal) return { type: 'none', dropped: 'no_proposal' }
  if (proposal.type === 'none') return { type: 'none' }
  if (proposal.type !== 'pause') return { type: 'none', dropped: 'type_not_allowed' }
  if (!Number.isInteger(proposal.weeks) || !menu.includes(proposal.weeks)) return { type: 'none', dropped: 'outside_policy_menu' }
  // When the words contain a return time, the server's own snap to the menu is authoritative.
  const hint = parseReturnHint(reason, now)
  if (hint) {
    const snapped = pauseWeeksFor(hint.weeks, menu)
    if (!snapped) return { type: 'none', dropped: 'return_too_far' }
    if (snapped !== proposal.weeks) return { type: 'pause', weeks: snapped, returnHint: hint.hint, snappedFrom: proposal.weeks }
    return { type: 'pause', weeks: proposal.weeks, returnHint: hint.hint }
  }
  return { type: 'pause', weeks: proposal.weeks, returnHint: quotedHint(proposal.return_hint, reason) }
}

// The "(you said ...)" text is only ever the subscriber's own words: a model hint that does not
// appear in the reason is dropped.
function quotedHint(hint, reason) {
  const h = String(hint || '').trim()
  if (!h || h.length > 200) return null
  const reasonText = String(reason || '')
  if (!reasonText.toLowerCase().includes(h.toLowerCase())) return null
  const phrase = timePhrase(h)
  // Never the whole message: a phrase that is the subscriber's entire sentence becomes the neutral label.
  const plain = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return plain(phrase) === plain(reasonText) ? RETURN_LABEL : phrase
}

const TIME_WORDS = /\b(after|until|till|when|once|by|in|for|next|weeks?|months?|days?|years?|holidays?|school|summer|winter|spring|fall|january|february|march|april|may|june|july|august|september|october|november|december)\b/i
const LEAD = /\b(after|until|till|when|once|next|in|for|by)\b/i
const TAIL = /\s+(then|and|i will|i'll|i am|i'm|we will|we'll)\b.*$/i
const MAX_QUOTE = 40

// Shown instead of a quote when the words hold no short time phrase. It is a paraphrase, not a quote.
export const RETURN_LABEL = "you'd be back later"

// Only the time words are quoted: "Back after the holidays, my kid is home" -> "after the holidays",
// "When school starts again I will come back" -> "when school starts again". A quote is always a
// substring of the subscriber's text (ignoring case); with no short time phrase the label is used.
export function timePhrase(text) {
  const clause = String(text || '').split(/[,;.!?]/).map((c) => c.trim()).find((c) => TIME_WORDS.test(c))
  if (!clause) return RETURN_LABEL
  const lead = clause.search(LEAD)
  const phrase = (lead > 0 ? clause.slice(lead) : clause).replace(TAIL, '').trim()
  if (!phrase || phrase.length > MAX_QUOTE) return RETURN_LABEL
  return LEAD.test(phrase.split(/\s+/)[0]) ? phrase[0].toLowerCase() + phrase.slice(1) : phrase
}

// ctx.agentKind records who really decided: the Claude tool loop, or the rule-based stand-in.
async function runAgent(state, ctx, agentImpl) {
  if (agentImpl) {
    ctx.agentKind = agentImpl === mockDecide ? 'stand-in' : agentImpl.kind || 'custom'
    return agentImpl(ctx)
  }
  const backend = llmBackendOf(state.config, state.clock.now())
  if (backend !== 'mock') {
    ctx.agentKind = backend === 'account' ? 'claude-account' : 'claude'
    const model = state.config.anthropicModel
    try { return await (backend === 'account' ? accountDecide(ctx, { model }) : claudeDecide(ctx, { apiKey: state.config.anthropicKey, model })) } catch (err) {
      if (!isOutage(err)) throw err
      ctx.calls.length = 0
      ctx.lookups = 0
      ctx.proposal = null
    }
  }
  // Local mode: a recorded real model run is replayed for its exact sentence, labelled with its date.
  const recording = backend === 'mock' && state.config.replayRecordedRuns ? findRecording(ctx.reason) : null
  if (recording) {
    ctx.agentKind = 'recorded'
    return replayDecide(ctx, recording)
  }
  ctx.agentKind = 'stand-in'
  return mockDecide(ctx)
}

// Without the agent, a return time that code can read ("until mid-January", "six weeks") still decides the
// pause, the same snap the server applies to a model answer. Otherwise the keyword rule card is shown.
// (S11 sandbox run: a late model left "until mid-January" on the 2 week rule card.)
function lateFallback(rule, text, menu, now) {
  const hint = rule.type === 'pause' ? parseReturnHint(text, now) : null
  if (hint) {
    const weeks = pauseWeeksFor(hint.weeks, menu)
    return weeks ? { shown: { type: 'pause', weeks, returnHint: hint.hint }, source: 'date read by code' } : { shown: { type: 'none' }, source: 'date read by code' }
  }
  return { shown: rule.type === 'pause' ? { type: 'pause', weeks: rule.weeks, returnHint: null } : { type: 'none' }, source: 'rule' }
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('late'), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Decides whether to show the subscriber one offer. The rule card is computed at once; the agent
 * result is used only if it arrives within agentTimeoutMs. The sub lock is NOT held while the agent
 * runs, so Cancel now never waits for it.
 */
export async function requestOffer(state, sub, reason, { agent } = {}) {
  const text = String(reason || '').trim()
  if (!text) return { skipped: 'no_reason', offer: sub.offer ? sub.offer.shown : null }
  return state.withLock(`offer:${sub.id}`, async () => {
    if (sub.offer || sub.offerRequested) return { repeat: true, offer: sub.offer?.shown || { type: 'none' }, detail: sub.offer || null }
    if (sub.status !== 'ACTIVE' || sub.pendingCancel) throw new HttpError(409, 'Offers are only made on active subscriptions.')
    sub.offerRequested = true
    sub.reason = text.slice(0, 300)
    const now = state.clock.now()
    const menu = state.policyStore.get().merchant.pauseMenuWeeks
    const rule = ruleCard(text, menu)
    const ctx = createToolContext({ state, sub, reason: text })
    const outcome = await withTimeout(runAgent(state, ctx, agent).then(() => 'done', () => 'error'), state.config.agentTimeoutMs)
    const agentArrived = outcome === 'done'
    const agentResult = agentArrived ? validateProposal(ctx.proposal, { menu, reason: text, now }) : null
    const quoteCents = sub.quoteCache?.quote?.cents
    const fallback = agentArrived ? null : lateFallback(rule, text, menu, now)
    const shown = agentArrived ? agentResult : fallback.shown
    if (sub.status !== 'ACTIVE' || sub.pendingCancel) return { offer: { type: 'none' }, discarded: 'cancelled_meanwhile' }
    sub.offer = {
      shown,
      source: agentArrived ? 'agent' : fallback.source,
      rule,
      agent: agentResult,
      agentKind: agentArrived ? ctx.agentKind || 'stand-in' : null,
      agentLate: outcome === 'late',
      recorded: agentArrived && ctx.recorded ? ctx.recorded : null,
      steps: ctx.calls.map((c) => ({ tool: c.tool, ok: c.ok, summary: c.summary || '' })),
      // A recorded reply is dropped when the server re-snapped the pause, so its words never disagree with the card.
      note: agentArrived && !(ctx.recorded && agentResult?.snappedFrom) ? sanitizeModelText(ctx.answer || ctx.modelText, quoteCents != null ? [quoteCents] : []) : null,
      shownAt: iso(state),
      consumed: false,
    }
    return { offer: shown, detail: sub.offer }
  })
}
