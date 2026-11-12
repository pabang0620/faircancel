export class PayPalError extends Error {
  constructor(status, name, issue, call) {
    super(`PayPal ${call?.path || ''}: ${issue || name} (${status})`)
    this.status = status
    this.paypalName = name
    this.issue = issue
    this.call = call
  }
}

const NETWORK_TEXT = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network|timeout|timed out|no response/i

// Network failures and 5xx are retried later; business errors (4xx) are not.
export function isTransient(err) {
  if (err instanceof PayPalError) return err.status >= 500 || err.status === 429 || err.status === 0
  return NETWORK_TEXT.test(String(err?.message))
}

// PayPal answers a cancel/suspend on the wrong state with issue SUBSCRIPTION_STATUS_INVALID. The Agent
// Toolkit drops the issue code and keeps only the description ("Invalid subscription status for cancel
// action; ..."), so both spellings count.
const STATUS_INVALID = /SUBSCRIPTION_STATUS_INVALID|invalid (?:subscription )?status/i
export function isStatusInvalid(err) {
  return STATUS_INVALID.test(`${err?.issue || ''} ${err?.message || ''}`)
}

// The Toolkit never throws. Its tool call returns JSON text, and a failure has one of two shapes
// (node_modules/@paypal/agent-toolkit/openai/index.js, run() and handleAxiosError()):
//   { ok: false, status?, code, message }           an LlmError: HTTP error, no response, setup error
//   { error: { message, type: 'paypal_error' } }    any other thrown error (for example while fetching the token)
// Returns a PayPalError, or null when the parsed value is not a failure.
export function toolkitFailure(parsed, call) {
  if (!parsed || typeof parsed !== 'object') return null
  const isLlmError = parsed.ok === false
  if (!isLlmError && !parsed.error) return null
  const raw = isLlmError ? parsed.message : (typeof parsed.error === 'string' ? parsed.error : parsed.error.message || JSON.stringify(parsed.error))
  const message = String(raw || 'Unknown error')
  let status = Number.isInteger(parsed.status) ? parsed.status : null
  if (status === null && parsed.code === 'PAYPAL_API_NO_RESPONSE') status = 0
  if (status === null) {
    const http = /status code (\d{3})/i.exec(message)
    if (http) status = Number(http[1])
    else status = NETWORK_TEXT.test(message) ? 0 : 422
  }
  const issue = STATUS_INVALID.test(message) ? 'SUBSCRIPTION_STATUS_INVALID' : message
  return new PayPalError(status, 'TOOLKIT', issue, call)
}
