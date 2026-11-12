import { z } from 'zod'
import { TOOL_DEFS, runTool } from './tools.js'
import { SYSTEM_PROMPT, userMessage } from './claudeAgent.js'

// Development only (LLM_BACKEND=account): the same system prompt and the same seven tools, run through the
// Claude Agent SDK so the developer's Claude Code login answers instead of an API key. Same ctx, same output.
const SERVER_NAME = 'faircancel'
const MAX_TURNS = 12

// The Claude Code process must never see an API key, or it would bill the API instead of the account.
export function envWithoutApiKey(env = process.env) {
  const { ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, ...rest } = env
  return rest
}

export function buildTools({ tool }, ctx) {
  return TOOL_DEFS.map((def) =>
    tool(def.name, def.description, z.fromJSONSchema(def.input_schema).shape, async (input) => {
      const out = await runTool(ctx, def.name, input)
      return { content: [{ type: 'text', text: JSON.stringify(out.result).slice(0, 4000) }], isError: !out.ok }
    }),
  )
}

// `sdk` is injectable so tests can drive the adapter without the real SDK or any login.
export async function accountDecide(ctx, { model, sdk, env = process.env }) {
  const agentSdk = sdk || (await import('@anthropic-ai/claude-agent-sdk'))
  const server = agentSdk.createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools: buildTools(agentSdk, ctx) })
  const stream = agentSdk.query({
    prompt: userMessage(ctx),
    options: {
      model,
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      allowedTools: [`mcp__${SERVER_NAME}__*`],
      mcpServers: { [SERVER_NAME]: server },
      maxTurns: MAX_TURNS,
      effort: 'low',
      settingSources: [],
      env: envWithoutApiKey(env),
    },
  })
  for await (const message of stream) {
    if (message.type !== 'result') continue
    if (message.subtype === 'success') ctx.modelText = String(message.result || '').trim()
    else if (message.subtype !== 'error_max_turns') throw new Error(`Account agent failed: ${message.subtype}`)
  }
}
