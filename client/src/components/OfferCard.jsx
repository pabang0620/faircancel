import { fmtDate } from '../api.js'

// The offer card has the same size and weight as the Cancel now button (see .btn--action).
export default function OfferCard({ view, busy, onPause }) {
  const offer = view.offer
  if (!offer || offer.type === 'none') {
    return (
      <div className="card card--offer">
        <p><strong>Nothing to offer for this reason.</strong></p>
        <p className="muted small">No discount, no extra steps. {view.cancelQuote ? `If you cancel now: refund ${view.cancelQuote.amount}.` : ''}</p>
      </div>
    )
  }
  return (
    <div className="card card--offer">
      <p><strong>Pause {offer.weeks} weeks instead?</strong>{offer.returnHint ? <span className="muted"> (you said {offer.returnHint})</span> : null}</p>
      <p className="muted small">Billing stops now and restarts on its own about {fmtDate(new Date(Date.now() + offer.weeks * 7 * 86_400_000).toISOString())}. Cancel now stays right above.</p>
      {offer.note ? <p className="small">{offer.note}</p> : null}
      <div className="actions">
        <button type="button" className="btn btn--action" onClick={onPause} disabled={busy === 'pause' || offer.consumed}>{busy === 'pause' ? 'Pausing...' : 'Pause'}</button>
      </div>
    </div>
  )
}
