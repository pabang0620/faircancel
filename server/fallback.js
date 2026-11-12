// Outage detection for the model API: when the key stops working the rule-based stand-in takes over.
const OUTAGE = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|request timed out|authentication|unauthori[sz]ed|invalid x-api-key|api key|credit balance|overloaded/i

export function isOutage(err) {
  if (!err) return false
  const status = err.status || err.statusCode
  if ([401, 403, 429, 500, 502, 503, 504, 529].includes(status)) return true
  if (['APIConnectionError', 'APIConnectionTimeoutError', 'AuthenticationError', 'PermissionDeniedError', 'InternalServerError', 'RateLimitError'].includes(err.constructor?.name)) return true
  return OUTAGE.test(String(err.message || err))
}
