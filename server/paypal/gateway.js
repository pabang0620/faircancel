import { randomUUID } from 'node:crypto'

const OPS = ['showSubscription', 'listTransactions', 'suspend', 'activate', 'cancel', 'getCapture', 'getCaptureRefunded', 'refundCapture', 'refundSale']
const MAX_LOG = 2000

// Every PayPal call (live or local) goes through here so the dashboard can show endpoint, ID and status code.
export function createActivityLog(clock = { now: () => Date.now() }) {
  const entries = []
  return {
    add(entry) {
      const full = { id: randomUUID(), at: new Date(clock.now()).toISOString(), ...entry }
      entries.push(full)
      if (entries.length > MAX_LOG) entries.splice(0, entries.length - MAX_LOG)
      return full
    },
    forSubscriptions(ids) { return entries.filter((e) => ids.has(e.subscriptionId)) },
    all() { return [...entries] },
  }
}

// Returns a client with the same operations that records each call against a subscription.
export function instrument(client, log, subscriptionId) {
  const wrapped = { backend: client.backend }
  for (const op of OPS) {
    wrapped[op] = async (...args) => {
      try {
        const out = await client[op](...args)
        log.add({ subscriptionId, backend: client.backend, op, method: out.call.method, path: out.call.path, via: out.call.via, status: out.status, ok: true, ref: op.startsWith('refund') && typeof out.data?.id === 'string' ? out.data.id : undefined })
        return out
      } catch (err) {
        log.add({ subscriptionId, backend: client.backend, op, method: err.call?.method, path: err.call?.path || op, via: err.call?.via, status: err.status ?? 0, ok: false, error: String(err.issue || err.message).slice(0, 160) })
        throw err
      }
    }
  }
  return wrapped
}
