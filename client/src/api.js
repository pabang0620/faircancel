async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` }))
  if (!res.ok || !json.success) {
    const err = new Error(json.message || `HTTP ${res.status}`)
    err.status = res.status
    err.code = json.code
    throw err
  }
  return json.data
}

export const api = {
  health: () => request('GET', '/api/health'),
  createSession: () => request('POST', '/api/session'),
  resetSession: (sessionId) => request('POST', '/api/session/reset', { sessionId }),
  claim: (sessionId, scenario, allowLocal = false) => request('POST', '/api/judge/claim', { sessionId, scenario, allowLocal }),
  view: (sessionId, id, fresh = false) => request('GET', `/api/subscriptions/${id}?sessionId=${sessionId}${fresh ? '&fresh=1' : ''}`),
  offer: (sessionId, id, reason) => request('POST', `/api/subscriptions/${id}/offer`, { sessionId, reason }),
  pause: (sessionId, id) => request('POST', `/api/subscriptions/${id}/pause`, { sessionId }),
  resume: (sessionId, id) => request('POST', `/api/subscriptions/${id}/resume`, { sessionId }),
  cancel: (sessionId, id, reason) => request('POST', `/api/subscriptions/${id}/cancel`, { sessionId, reason }),
  sync: (sessionId, id) => request('POST', `/api/subscriptions/${id}/sync`, { sessionId }),
  merchant: (sessionId) => request('GET', `/api/merchant?sessionId=${sessionId}`),
}

const KEY = 'faircancel.session'
export const storage = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
  },
  set(value) {
    try { localStorage.setItem(KEY, JSON.stringify(value)) } catch { /* storage unavailable */ }
  },
}

const DATE = { month: 'short', day: 'numeric' }
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', DATE) : '-')
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { ...DATE, hour: '2-digit', minute: '2-digit', hour12: false }) : '-')
