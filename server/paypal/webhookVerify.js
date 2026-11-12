// VERIFY S10: a sandbox webhook is only acted on after PayPal's verify-webhook-signature accepts it for
// PAYPAL_WEBHOOK_ID. Acting on it only means re-reading the subscription from PayPal, never trusting the payload.
const SANDBOX = 'https://api-m.sandbox.paypal.com'

export async function verifyWebhookSignature({ clientId, clientSecret, webhookId, headers, event, fetchImpl = fetch }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const tokenRes = await fetchImpl(`${SANDBOX}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  if (!tokenRes.ok) return 'FAILURE'
  const { access_token: token } = await tokenRes.json()
  const res = await fetchImpl(`${SANDBOX}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  })
  if (!res.ok) return 'FAILURE'
  return (await res.json()).verification_status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE'
}
