import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai'
import { PayPalError, toolkitFailure } from './errors.js'

// Real PayPal Sandbox. Lifecycle reads, cancel and the v2 refund go through the PayPal Agent
// Toolkit; suspend, activate, transactions, capture lookup and the v1 sale refund are REST
// calls because the toolkit has no tool for them. Never used unless sandbox credentials exist.
const API_BASE = 'https://api-m.sandbox.paypal.com'
const TRANSACTION_WINDOW_DAYS = 45

const ACTIONS = {
  products: { create: true, list: true, show: true },
  subscriptionPlans: { create: true, list: true, show: true },
  subscriptions: { create: true, show: true, cancel: true },
  payments: { createRefund: true, getRefunds: true },
}

export function createLiveClient({ clientId, clientSecret, fetchImpl = fetch }) {
  // The toolkit defaults to the LIVE PayPal API unless context.sandbox is true.
  const makeToolkit = (extraContext = {}) => new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions: ACTIONS, context: { sandbox: true, ...extraContext } } })
  const toolkit = makeToolkit()
  let counter = 0
  let token = { value: null, expires: 0 }

  async function accessToken() {
    if (token.value && Date.now() < token.expires - 60_000) return token.value
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetchImpl(`${API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new PayPalError(res.status, 'AUTH', 'invalid_client', { method: 'POST', path: '/v1/oauth2/token', via: 'rest' })
    const data = await res.json()
    token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }
    return token.value
  }

  async function rest(method, path, body, requestId) {
    const c = { method, path, via: 'rest' }
    const headers = { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }
    if (requestId) headers['PayPal-Request-Id'] = requestId
    const res = await fetchImpl(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = {} }
    if (!res.ok) throw new PayPalError(res.status, data.name, data.details?.[0]?.issue || data.name, c)
    return { status: res.status, data, call: c }
  }

  // The toolkit reports failures inside the returned JSON, never by throwing (see errors.js).
  async function viaToolkit(name, args, c, kit = toolkit) {
    counter += 1
    const result = await kit.handleToolCall({ id: `call_${counter}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
    const parsed = JSON.parse(result.content)
    const failure = toolkitFailure(parsed, { ...c, tool: name })
    if (failure) throw failure
    return parsed
  }

  return {
    backend: 'sandbox',
    async showSubscription(id) {
      const c = { method: 'GET', path: `/v1/billing/subscriptions/${id}`, via: 'toolkit show_subscription_details' }
      return { status: 200, data: await viaToolkit('show_subscription_details', { subscription_id: id }, c), call: c }
    },
    listTransactions(id) {
      const since = new Date(Date.now() - TRANSACTION_WINDOW_DAYS * 86_400_000).toISOString()
      const end = new Date(Date.now() + 86_400_000).toISOString()
      return rest('GET', `/v1/billing/subscriptions/${id}/transactions?start_time=${encodeURIComponent(since)}&end_time=${encodeURIComponent(end)}`)
    },
    suspend: (id, reason) => rest('POST', `/v1/billing/subscriptions/${id}/suspend`, { reason: reason.slice(0, 128) }),
    activate: (id, reason) => rest('POST', `/v1/billing/subscriptions/${id}/activate`, { reason: reason.slice(0, 128) }),
    async cancel(id, reason) {
      const c = { method: 'POST', path: `/v1/billing/subscriptions/${id}/cancel`, via: 'toolkit cancel_subscription' }
      await viaToolkit('cancel_subscription', { subscription_id: id, payload: { reason: reason.slice(0, 128) } }, c)
      return { status: 204, data: {}, call: c }
    },
    getCapture: (captureId) => rest('GET', `/v2/payments/captures/${captureId}`),
    // Total already refunded on a capture, read from the capture itself. Used before any retry of a refund
    // whose answer was lost, because the Toolkit tool has no list-refunds call.
    async getCaptureRefunded(captureId) {
      const out = await rest('GET', `/v2/payments/captures/${captureId}`)
      const value = out.data?.seller_payable_breakdown?.total_refunded_amount?.value
      // Sandbox check V14 (2026-11-12): a refunded capture carries no refunded total, only status PARTIALLY_REFUNDED/REFUNDED.
      // Money left but the amount is unknown, so an earlier lost refund cannot be confirmed: end as "refund by hand".
      if (!value && /REFUNDED/.test(out.data?.status || '')) throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'REFUNDED_TOTAL_UNAVAILABLE', out.call)
      return { status: out.status, data: { refundedCents: value ? Math.round(Number(value) * 100) : 0 }, call: out.call }
    },
    async refundCapture(captureId, { amountCents, note, requestId }) {
      const c = { method: 'POST', path: `/v2/payments/captures/${captureId}/refund`, via: 'toolkit create_refund' }
      // A toolkit built with context.request_id sends PayPal-Request-Id, so PayPal itself de-duplicates a repeat.
      const kit = requestId ? makeToolkit({ request_id: requestId }) : toolkit
      const data = await viaToolkit('create_refund', { capture_id: captureId, amount: { currency_code: 'USD', value: (amountCents / 100).toFixed(2) }, note_to_payer: note }, c, kit)
      return { status: 201, data, call: c }
    },
    refundSale: (saleId, { amountCents, requestId }) =>
      rest('POST', `/v1/payments/sale/${saleId}/refund`, { amount: { total: (amountCents / 100).toFixed(2), currency: 'USD' } }, requestId),
    // Used only by scripts/seedLive.js and scripts/verifyS3.js (run by a person).
    toolkitCall: (name, args) => viaToolkit(name, args, { method: 'TOOLKIT', path: name, via: `toolkit ${name}` }),
    rest,
  }
}
