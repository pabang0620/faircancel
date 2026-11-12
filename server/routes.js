import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { HttpError, parse, sessionIdSchema, subscriptionIdSchema } from './http.js'
import { merchantPolicyPatchSchema } from './policy.js'

const OFFERS_PER_IP_HOUR = Number(process.env.OFFERS_PER_IP_HOUR || 40)
const hits = new Map()

function offerLimited(ip) {
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3_600_000)
  hits.set(ip, [...recent, now])
  return recent.length >= OFFERS_PER_IP_HOUR
}

const body = {
  claim: z.object({ sessionId: sessionIdSchema, scenario: z.coerce.number().int().min(1).max(4), allowLocal: z.boolean().optional() }),
  offer: z.object({ sessionId: sessionIdSchema, reason: z.string().max(300) }),
  withSession: z.object({ sessionId: sessionIdSchema }),
  cancel: z.object({ sessionId: sessionIdSchema, reason: z.string().max(300).optional() }),
  query: z.object({ sessionId: sessionIdSchema, fresh: z.enum(['0', '1']).optional() }),
  webhook: z.object({ id: z.string().max(80).optional(), event_type: z.string().max(80), resource: z.object({ id: z.string().max(80).optional(), billing_agreement_id: z.string().max(80).optional() }).passthrough() }).passthrough(),
}

export function createRouter(services, { modes, config }) {
  const api = Router()
  const wrap = (fn) => async (req, res, next) => {
    try { res.json({ success: true, data: await fn(req) }) } catch (err) { next(err) }
  }
  const subId = (req) => parse(subscriptionIdSchema, req.params.id)

  api.get('/health', wrap(async () => ({ ok: true, modes, merchant: config.merchantName, refundPath: config.refundPath, pool: services.poolStatus() })))
  api.post('/session', wrap(async () => ({ sessionId: randomUUID() })))
  api.post('/judge/claim', wrap(async (req) => {
    const b = parse(body.claim, req.body)
    return services.claim(b.sessionId, b.scenario, !!b.allowLocal, { ip: req.ip })
  }))
  api.post('/session/reset', wrap(async (req) => services.resetSession(parse(body.withSession, req.body).sessionId)))
  api.get('/subscriptions/:id', wrap(async (req) => {
    const q = parse(body.query, req.query)
    return services.view(q.sessionId, subId(req), { fresh: q.fresh === '1' })
  }))
  api.post('/subscriptions/:id/offer', wrap(async (req) => {
    const b = parse(body.offer, req.body)
    return services.offer(b.sessionId, subId(req), b.reason, { forceMock: offerLimited(req.ip) })
  }))
  api.post('/subscriptions/:id/pause', wrap(async (req) => services.pause(parse(body.withSession, req.body).sessionId, subId(req))))
  api.post('/subscriptions/:id/resume', wrap(async (req) => services.resume(parse(body.withSession, req.body).sessionId, subId(req))))
  api.post('/subscriptions/:id/cancel', wrap(async (req) => {
    const b = parse(body.cancel, req.body)
    return services.cancel(b.sessionId, subId(req), b.reason)
  }))
  api.post('/subscriptions/:id/sync', wrap(async (req) => services.sync(parse(body.withSession, req.body).sessionId, subId(req))))
  api.get('/merchant', wrap(async (req) => services.merchantView(parse(body.query, req.query).sessionId)))
  api.get('/policy', wrap(async () => services.policy()))
  api.put('/policy', wrap(async (req) => {
    if (process.env.ALLOW_POLICY_EDIT !== '1') throw new HttpError(403, 'Policy editing is off on this demo.')
    return services.updatePolicy(parse(merchantPolicyPatchSchema, req.body))
  }))
  api.post('/webhooks/paypal', wrap(async (req) => services.applyWebhook(parse(body.webhook, req.body))))
  return api
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)
  if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message, code: err.code })
  if (err?.name === 'ZodError') return res.status(400).json({ success: false, message: err.issues.map((i) => i.message).join('; ') })
  if (err?.paypalName || err?.call) return res.status(502).json({ success: false, message: 'PayPal could not complete that request. Please try again.', code: 'paypal_error' })
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid JSON.' })
  console.error('[error]', err?.message)
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' })
}
