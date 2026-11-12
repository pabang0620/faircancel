import { useCallback, useEffect, useState } from 'react'
import { api, fmtDate, fmtDateTime } from '../api.js'
import StatusBadge from './StatusBadge.jsx'
import CancelNowBar from './CancelNowBar.jsx'
import OfferCard from './OfferCard.jsx'
import ResultCard from './ResultCard.jsx'

export default function SubscriberPanel({ sessionId, subscriptionId, merchantStatus, hint = null }) {
  const [view, setView] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (fresh = false) => {
    try { setView(await api.view(sessionId, subscriptionId, fresh)) } catch (err) { setError(err.message) }
  }, [sessionId, subscriptionId])

  useEffect(() => { setReason(''); setError(''); load() }, [load])
  // The merchant side noticed a state change (for example a scheduled resume): refresh this side.
  useEffect(() => { if (view && merchantStatus && merchantStatus !== view.status) load() }, [merchantStatus, view, load])

  async function run(name, fn) {
    setBusy(name)
    setError('')
    try { const out = await fn(); setView(out.view || out) } catch (err) { setError(err.message); load() } finally { setBusy('') }
  }

  // Cancel now never waits for the agent: it only waits for its own fresh refund quote.
  const cancelNow = () => run('cancel', async () => {
    await api.view(sessionId, subscriptionId, true).catch(() => null)
    return api.cancel(sessionId, subscriptionId, reason)
  })

  return (
    <section className="panel panel--sub" aria-label="Subscriber view">
      <div className="panel__head">
        <h2>Subscriber</h2>
        <span className="muted small">{view?.merchantName || 'Clay Studio'} (fictional)</span>
      </div>
      <div className="substate">
        <div>
          <p className="substate__plan">{view ? `${view.planName} ${view.priceLabel}` : 'Loading...'}</p>
          <p className="muted small mono">{subscriptionId}</p>
        </div>
        {view ? <StatusBadge status={view.status} large /> : null}
      </div>
      <CancelNowBar view={view} busy={busy} onCancel={cancelNow} />
      {view ? <StateBody view={view} reason={reason} setReason={setReason} busy={busy} run={run} sessionId={sessionId} subscriptionId={subscriptionId} /> : null}
      {view && !view.offerUsed && view.status === 'ACTIVE' ? hint : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  )
}

function StateBody({ view, reason, setReason, busy, run, sessionId, subscriptionId }) {
  if (view.status === 'CANCELLED' || view.result) return <ResultCard view={view} />
  if (view.status === 'SUSPENDED') {
    return (
      <div className="card card--state">
        <p><strong>{view.backend === 'local' ? 'Paused (local stand-in).' : 'Paused on PayPal.'}</strong> Resumes {fmtDate(view.resumesAt)} (scheduled by FairCancel).</p>
        <div className="actions">
          <button type="button" className="btn btn--action" onClick={() => run('resume', () => api.resume(sessionId, subscriptionId))} disabled={busy === 'resume'}>
            {busy === 'resume' ? 'Resuming...' : 'Resume now'}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="stack">
      <p className="muted small">Next charge {fmtDate(view.nextCharge)}{view.paidAt ? ` (last paid ${fmtDateTime(view.paidAt)})` : ''}</p>
      {view.offerUsed ? (
        <OfferCard view={view} busy={busy} onPause={() => run('pause', () => api.pause(sessionId, subscriptionId))} />
      ) : (
        <form className="reason" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) run('offer', () => api.offer(sessionId, subscriptionId, reason)) }}>
          <label htmlFor="reason">Why are you leaving? (optional)</label>
          <div className="reason__row">
            <input id="reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Tell us in a few words" />
            <button type="submit" className="btn btn--action btn--quiet" disabled={!reason.trim() || busy === 'offer'}>{busy === 'offer' ? 'Reading...' : 'Send'}</button>
          </div>
          {busy === 'offer' ? <p className="muted small">Reading your reason. Cancel now stays available.</p> : null}
        </form>
      )}
    </div>
  )
}
