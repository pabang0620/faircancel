import { fmtDateTime } from '../api.js'

// Always rendered, always in the same place: the button and the refund line under it.
// It is clickable while loading and after an error too; only a finished cancel or its own request disables it.
export default function CancelNowBar({ view, busy, onCancel }) {
  const cancelled = view?.status === 'CANCELLED'
  const quote = view?.cancelQuote
  let line
  if (cancelled) line = view.backend === 'local' ? 'Already cancelled (local stand-in).' : 'Already cancelled on PayPal.'
  else if (view?.quoteError) line = 'Refund amount is being checked with PayPal.'
  else if (quote) {
    const amount = quote.held ? 'to be sent when your payment completes' : quote.amount
    line = `If you cancel now: refund ${amount}`
  } else line = 'Checking what cancelling means...'
  return (
    <div className="cancelbar">
      <button type="button" className="btn btn--action btn--cancel" onClick={onCancel} disabled={cancelled || busy === 'cancel'}>
        {busy === 'cancel' ? 'Cancelling...' : 'Cancel now'}
      </button>
      <p className="cancelbar__line">
        {line}
        {!cancelled && view?.policy ? <span className="muted small"> ({view.policy.by}'s policy, set {fmtDateTime(view.policy.setAt)})</span> : null}
      </p>
    </div>
  )
}
