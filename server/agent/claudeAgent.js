import Anthropic from '@anthropic-ai/sdk'
import { TOOL_DEFS, runTool, MAX_TOOL_CALLS } from './tools.js'

export const SYSTEM_PROMPT = `You are the FairCancel agent on a subscriber cancel page for a small PayPal Subscriptions seller. The subscriber has already seen a "Cancel now" button and the refund they get if they cancel; it stays on screen and never waits for you.

Your only job: read the subscriber's reason and decide whether ONE pause offer fits.
- Call get_policy first. The merchant pause menu is the only set of allowed pause lengths.
- If the reason says when they come back ("until mid-January", "5 weeks off"), call get_subscription_state, then propose_offer with type "pause", the weeks from the menu closest to the return time, and return_hint with their own words.
- If the return time is in other words ("after the holidays", "when school starts", "my recovery, the doctor said about six weeks"), work out the number of weeks from today (given in the user message and by get_policy), pick the closest menu value, and set return_hint to the subscriber's own words copied exactly from the reason. Never invent a hint.
- If a pause does not fit (too expensive, not using it, moving, quitting) or they complain about a charge, call get_usage_record and quote_refund (or list_recent_payments for a charge complaint) and then propose_offer with type "none". Never offer a discount, a coupon or a price change. They do not exist here.
- You cannot pause, cancel or refund anything. You never calculate money. If you mention an amount, copy it from quote_refund.
- Use at most ${MAX_TOOL_CALLS} tool calls. Finish with propose_offer. Keep any text to one short sentence.`

export const userMessage = (ctx) => `Today is ${new Date(ctx.state.clock.now()).toISOString().slice(0, 10)}. Subscriber reason: ${JSON.stringify(ctx.reason)}`

let client = null
const getClient = (apiKey) => (client ||= new Anthropic({ apiKey }))

// `complete` is injectable so tests can drive the loop without any network.
export async function claudeDecide(ctx, { apiKey, model, complete }) {
  const create = complete || ((params) => getClient(apiKey).messages.create(params))
  const tools = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
  const messages = [{ role: 'user', content: userMessage(ctx) }]
  for (let step = 0; step < MAX_TOOL_CALLS + 1; step += 1) {
    const response = await create({ model, max_tokens: 1024, system: SYSTEM_PROMPT, tools, messages })
    messages.push({ role: 'assistant', content: response.content })
    const uses = response.content.filter((b) => b.type === 'tool_use')
    if (response.stop_reason !== 'tool_use' || uses.length === 0) {
      ctx.modelText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      return
    }
    const results = []
    for (const use of uses) {
      const out = await runTool(ctx, use.name, use.input)
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out.result).slice(0, 4000), is_error: !out.ok })
    }
    messages.push({ role: 'user', content: results })
    if (ctx.capped) return
  }
}
