import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { makeEnv } from './helpers.js'

let server
let base
let env

before(async () => {
  env = makeEnv()
  await new Promise((resolve) => { server = env.app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}/api`
})
after(() => server.close())

const call = async (method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json() }
}

test('health reports local mode without any outside call', async () => {
  const { json } = await call('GET', '/health')
  assert.equal(json.data.modes.paypal, 'local')
  assert.equal(json.data.pool.banner, 'local mode, no PayPal calls')
})

test('session separation: another session cannot read or cancel my subscription', async () => {
  const a = (await call('POST', '/session')).json.data.sessionId
  const b = (await call('POST', '/session')).json.data.sessionId
  const claimed = await call('POST', '/judge/claim', { sessionId: a, scenario: 2 })
  assert.equal(claimed.status, 200)
  const id = claimed.json.data.id
  assert.equal((await call('GET', `/subscriptions/${id}?sessionId=${b}`)).status, 404)
  assert.equal((await call('POST', `/subscriptions/${id}/cancel`, { sessionId: b })).status, 404)
  assert.equal((await call('POST', `/subscriptions/${id}/pause`, { sessionId: b })).status, 404)
  const mine = await call('GET', `/merchant?sessionId=${b}`)
  assert.equal(mine.json.data.subscriptions.length, 0)
  assert.equal((await call('GET', `/subscriptions/${id}?sessionId=${a}`)).status, 200)
})

test('inputs are validated with zod', async () => {
  const a = (await call('POST', '/session')).json.data.sessionId
  assert.equal((await call('POST', '/judge/claim', { sessionId: 'nope', scenario: 2 })).status, 400)
  assert.equal((await call('POST', '/judge/claim', { sessionId: a, scenario: 9 })).status, 400)
  assert.equal((await call('GET', `/subscriptions/not-an-id?sessionId=${a}`)).status, 400)
  const v = (await call('POST', '/judge/claim', { sessionId: a, scenario: 1 })).json.data
  assert.equal((await call('POST', `/subscriptions/${v.id}/offer`, { sessionId: a, reason: 'x'.repeat(500) })).status, 400)
  // there is no way to send an amount: extra fields are ignored and the server quotes
  const cancelled = await call('POST', `/subscriptions/${v.id}/cancel`, { sessionId: a, amount: 9999 })
  assert.equal(cancelled.json.data.result.refund.amountLabel, '$7.71')
})

test('policy edits are off by default and the state layer is not editable', async () => {
  assert.equal((await call('PUT', '/policy', { refundMode: 'access_until_end' })).status, 403)
  process.env.ALLOW_POLICY_EDIT = '1'
  try {
    assert.equal((await call('PUT', '/policy', { cancelNowAlwaysVisible: false })).status, 400)
    assert.equal((await call('PUT', '/policy', { refundMode: 'access_until_end' })).status, 200)
  } finally { delete process.env.ALLOW_POLICY_EDIT }
})

test('webhook payloads are validated and unknown subscriptions are ignored', async () => {
  assert.equal((await call('POST', '/webhooks/paypal', { nope: true })).status, 400)
  const ok = await call('POST', '/webhooks/paypal', { event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-NOTOURS12345' } })
  assert.equal(ok.json.data.handled, false)
})
