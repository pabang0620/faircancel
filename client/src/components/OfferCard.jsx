import { fmtDate } from '../api.js'

// Said on the subscriber side too: in local mode a sentence without a recorded model run is read by a program.
const STAND_IN_LINE = 'Read by the rule-based stand-in: no model runs in local mode and this sentence has no recorded run.'

// The Pause button has the same size and weight as the Cancel now button (see .btn--action).
export default function OfferCard({ view, busy, onPause }) {
  const offer = view.offer
  const standIn = offer?.decidedBy === 'stand-in' ? <p className="card__note">{STAND_IN_LINE}</p> : null
  if (!offer || offer.type === 'none') {
    return (
      <div className="card card--offer card--none">
        <span className="card__icon" aria-hidden="true">&#8211;</span>
        <div className="card__body">
          <p className="card__title">Nothing to offer for this reason.</p>
          <p className="card__text">No discount, no extra steps. {view.cancelQuote ? `If you cancel now: refund ${view.cancelQuote.amount}.` : ''}</p>
          {standIn}
        </div>
      </div>
    )
  }
  return (
    <div className="card card--offer">
      <span className="card__icon" aria-hidden="true">II</span>
      <div className="card__body">
        <p className="card__title">Pause {offer.weeks} weeks instead?{offer.returnHint ? <span className="card__said"> (you said {offer.returnHint})</span> : null}</p>
        <p className="card__text">Billing stops now and restarts on its own about {fmtDate(new Date(Date.now() + offer.weeks * 7 * 86_400_000).toISOString())}. Cancel now stays right above.</p>
        {offer.note ? <p className="card__note">{offer.note}{offer.noteFrom ? <span> ({offer.noteFrom})</span> : null}</p> : null}
        {standIn}
      </div>
      <div className="actions">
        <button type="button" className="btn btn--action btn--pause" onClick={onPause} disabled={busy === 'pause' || offer.consumed}>{busy === 'pause' ? 'Pausing...' : 'Pause'}</button>
      </div>
    </div>
  )
}
