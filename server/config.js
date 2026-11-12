import 'dotenv/config'

const forceMock = process.env.FORCE_MOCK === '1'
const port = Number(process.env.PORT || 3002)
const llmBackend = forceMock ? 'mock' : process.env.LLM_BACKEND === 'account' ? 'account' : process.env.ANTHROPIC_API_KEY ? 'api' : 'mock'

export const config = {
  port,
  dataDir: process.env.DATA_DIR || 'data',
  merchantName: process.env.MERCHANT_NAME || 'Clay Studio',
  anthropicKey: forceMock ? '' : process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  // mock (default), api (ANTHROPIC_API_KEY) or account (local Claude Code login, development only).
  llmBackend,
  // Paid model access ends with the hackathon results; after this the rule-based stand-in answers.
  llmLiveUntil: Date.parse(process.env.LLM_LIVE_UNTIL || '2026-12-22T00:00:00+09:00'),
  paypalClientId: forceMock ? '' : process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: forceMock ? '' : process.env.PAYPAL_CLIENT_SECRET || '',
  // Fixed from the S3 result in VERIFY.md. Never switches at runtime.
  refundPath: process.env.REFUND_PATH === 'v1sale' ? 'v1sale' : 'v2capture',
  // The account backend starts a Claude Code process per decision (measured 5.7 to 8.7 s, VERIFY C1), so it gets more room.
  agentTimeoutMs: Number(process.env.AGENT_TIMEOUT_MS || (llmBackend === 'account' ? 15000 : 6000)),
  refundMaxTries: Number(process.env.REFUND_MAX_TRIES || 3),
  newSessionsPerIpHour: Number(process.env.NEW_SESSIONS_PER_IP_HOUR || 10),
  seedsPerIpHour: Number(process.env.SEEDS_PER_IP_HOUR || 12),
  maxSeedsPerSession: Number(process.env.MAX_SEEDS_PER_SESSION || 4),
  mockV2Refund: process.env.MOCK_V2_REFUND !== '0',
  mockSuspendedCancel: process.env.MOCK_SUSPENDED_CANCEL !== '0',
}

export const modes = {
  llm: config.llmBackend === 'account' ? 'account' : config.llmBackend === 'api' ? 'live' : 'mock',
  paypal: config.paypalClientId && config.paypalClientSecret ? 'sandbox' : 'local',
}
