// Which model answers as "Agent": the hosted API (key), the local Claude Code account, or the stand-in.
// Config objects built by tests carry only anthropicKey, so the backend falls back to it.
export function llmBackendOf(config, now) {
  if (!(now < config.llmLiveUntil)) return 'mock'
  if (config.llmBackend === 'account') return 'account'
  if (config.llmBackend === 'api' || (config.llmBackend === undefined && config.anthropicKey)) return config.anthropicKey ? 'api' : 'mock'
  return 'mock'
}
