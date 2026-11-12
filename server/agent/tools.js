import { z } from 'zod'
import { clientFor } from '../state.js'
import { liveQuote } from '../cancelFlow.js'
import { usd } from '../money.js'

// Seven tools, none of which can change a subscription or move money.
// propose_offer only records a proposal; the server validates it against the policy.
export const MAX_TOOL_CALLS = 8
export const MAX_LOOKUPS = 5
const LOOKUPS = new Set(['get_subscription_state', 'list_recent_payments', 'get_usage_record', 'get_policy', 'quote_refund'])

export const TOOL_DEFS = [
  { name: 'get_subscription_state', description: 'Current PayPal state of this subscription: status and next billing time.', input_schema: { type: 'object', properties: {} } },
  { name: 'list_recent_payments', description: 'The two most recent PayPal payments of this subscription (status, amount in USD, time).', input_schema: { type: 'object', properties: {} } },
  { name: 'get_usage_record', description: "The merchant's record of how many classes the subscriber attended in the current paid week.", input_schema: { type: 'object', properties: {} } },
  { name: 'get_policy', description: "The merchant's policy: pause menu in weeks, refund rule, and the fixed rules (one offer at most, a pause only, never a discount).", input_schema: { type: 'object', properties: {} } },
  { name: 'quote_refund', description: 'Server-calculated refund if the subscriber cancels right now. Quote this figure; never calculate your own.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'propose_offer',
    description: 'Propose at most one offer. type "pause" needs weeks from the merchant pause menu and return_hint (the subscriber words that told you when they return). type "none" when a pause does not fit the reason. No other type exists.',
    input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['pause', 'none'] }, weeks: { type: 'number' }, return_hint: { type: 'string' } }, required: ['type'] },
  },
  { name: 'answer_subscriber', description: 'Answer a question the subscriber asked. Plain text, no prices of your own.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
]

const proposeSchema = z.object({ type: z.string().max(20), weeks: z.number().optional(), return_hint: z.string().max(200).optional() })
const answerSchema = z.object({ text: z.string().max(600) })

export function createToolContext({ state, sub, reason }) {
  return { state, sub, reason, calls: [], lookups: 0, proposal: null, answer: null, capped: false }
}

export async function runTool(ctx, name, input = {}) {
  const { state, sub } = ctx
  if (ctx.calls.length >= MAX_TOOL_CALLS || (LOOKUPS.has(name) && ctx.lookups >= MAX_LOOKUPS)) {
    ctx.capped = true
    return { ok: false, result: { error: 'Tool call limit reached. Finish with propose_offer.' } }
  }
  const step = { tool: name, input, ok: true }
  ctx.calls.push(step)
  if (LOOKUPS.has(name)) ctx.lookups += 1
  try {
    const result = await dispatch(ctx, name, input, state, sub)
    step.summary = summarize(name, result)
    return { ok: true, result }
  } catch (err) {
    step.ok = false
    step.summary = String(err.message).slice(0, 120)
    return { ok: false, result: { error: String(err.message).slice(0, 200) } }
  }
}

async function dispatch(ctx, name, input, state, sub) {
  switch (name) {
    case 'get_subscription_state': {
      const d = (await clientFor(state, sub).showSubscription(sub.id)).data
      return { status: d.status, next_billing_time: d.billing_info?.next_billing_time || null, plan: `${state.config.merchantName} weekly class pass, $9.00 per week` }
    }
    case 'list_recent_payments': {
      const list = (await clientFor(state, sub).listTransactions(sub.id)).data.transactions || []
      return { payments: [...list].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 2).map((t) => ({ id: t.id, status: t.status, amount_usd: t.amount_with_breakdown?.gross_amount?.value, time: t.time })) }
    }
    case 'get_usage_record':
      return { classes_attended_this_period: sub.usageCount }
    case 'get_policy': {
      const p = state.policyStore.get()
      return { today: new Date(state.clock.now()).toISOString().slice(0, 10), state_rule: p.state.label, offers_allowed: p.house.offerTypes, max_offers: p.house.maxOffersPerSubscription, discounts: false, pause_menu_weeks: p.merchant.pauseMenuWeeks, refund_mode: p.merchant.refundMode, full_refund_if_no_class_attended: p.merchant.fullRefundIfNoUsage }
    }
    case 'quote_refund': {
      const q = await liveQuote(state, sub, { fresh: true })
      return { refund_usd: (q.cents / 100).toFixed(2), formula: q.formula || q.message, rule: q.reason }
    }
    case 'propose_offer':
      ctx.proposal = proposeSchema.parse(input)
      return { recorded: true, note: 'The server checks the proposal against the merchant policy.' }
    case 'answer_subscriber':
      ctx.answer = answerSchema.parse(input).text
      return { recorded: true }
    default:
      throw new Error(`Unknown tool ${name}`)
  }
}

function summarize(name, result) {
  if (name === 'quote_refund') return `refund ${usd(Math.round(Number(result.refund_usd) * 100))}`
  if (name === 'get_usage_record') return `${result.classes_attended_this_period} classes this week`
  if (name === 'get_subscription_state') return result.status
  if (name === 'list_recent_payments') return `${result.payments.length} payments`
  if (name === 'get_policy') return `pause ${result.pause_menu_weeks.join('/')}w, no discounts`
  return ''
}

// Model text is only shown if every dollar figure in it is a server figure.
export function sanitizeModelText(text, allowedCents) {
  if (!text) return null
  const allowed = new Set(allowedCents.map((c) => (c / 100).toFixed(2)))
  const figures = [...String(text).matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')).toFixed(2))
  return figures.every((f) => allowed.has(f)) ? String(text).slice(0, 400) : null
}
