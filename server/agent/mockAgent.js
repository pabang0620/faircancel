import { runTool } from './tools.js'
import { parseReturnHint, pauseWeeksFor } from '../returnHint.js'

// Stand-in for the model when no Anthropic key is set. It makes the same tool calls, in the same
// order, that the Claude prompt asks for, so "How FairCancel decided" shows real tool runs.
// Unlike the keyword rule card it reads a return date out of free text.
const BILLING_COMPLAINT = /\b(charged|refund|billed)\b/i

export async function mockDecide(ctx) {
  const { reason, state } = ctx
  const menu = state.policyStore.get().merchant.pauseMenuWeeks
  await runTool(ctx, 'get_policy')
  const hint = parseReturnHint(reason, state.clock.now())
  const weeks = hint ? pauseWeeksFor(hint.weeks, menu) : null
  if (BILLING_COMPLAINT.test(reason)) {
    await runTool(ctx, 'list_recent_payments')
    await runTool(ctx, 'get_usage_record')
    await runTool(ctx, 'quote_refund')
    await runTool(ctx, 'propose_offer', { type: 'none' })
    return
  }
  if (weeks) {
    await runTool(ctx, 'get_subscription_state')
    await runTool(ctx, 'propose_offer', { type: 'pause', weeks, return_hint: hint.hint })
    return
  }
  const temporary = /\b(back|return|exam|exams|surgery|vacation|holiday|break|trip|busy)\b/i.test(reason) && !/\b(moving|quit|quitting|not using)\b/i.test(reason)
  if (temporary) {
    await runTool(ctx, 'get_subscription_state')
    await runTool(ctx, 'propose_offer', { type: 'pause', weeks: menu[0], return_hint: 'no return time found' })
    return
  }
  await runTool(ctx, 'get_usage_record')
  await runTool(ctx, 'quote_refund')
  await runTool(ctx, 'propose_offer', { type: 'none' })
}
