import { fmtDateTime } from '../api.js'

export default function ResultCard({ view }) {
  const result = view.result
  if (!result) return null
  if (result.kind === 'queued') {
    return <div className="card card--warn"><p><strong>{result.message}</strong></p><p className="muted small">Cancel now is still here if you want to try again.</p></div>
  }
  const q = result.quote
  const refund = result.refund
  const local = view.backend === 'local'
  return (
    <div className="card card--result">
      <p><strong>{local ? 'Cancelled in the local stand-in (mock). No PayPal call was made.' : 'Cancelled on PayPal. No further charges.'}</strong></p>
      <p className="muted small">Cancelled {fmtDateTime(result.cancelledAt)}</p>
      {refund ? (
        <>
          <p className="result__formula num">{q.formula}</p>
          {local ? (
            <p>Refund {refund.amountLabel} recorded locally (mock, nothing was sent to PayPal). Local reference <span className="mono">{refund.id}</span></p>
          ) : (
            <p>Refund {refund.amountLabel} sent via PayPal ({refund.path}, {refund.id ? <>ID <span className="mono">{refund.id}</span></> : 'confirmed on the capture, PayPal ID not received'})</p>
          )}
        </>
      ) : result.phase === 'refund_waiting' ? (
        <p>{result.message}</p>
      ) : result.phase === 'refund_failed' ? (
        <p>The refund could not be sent automatically and FairCancel has stopped trying. {view.merchantName} has been told to refund it by hand.</p>
      ) : (
        <p>{q.message || 'No refund is due under the merchant policy.'}</p>
      )}
      <p className="muted small">Refund rule set by {result.policy.by} on {fmtDateTime(result.policy.setAt)}</p>
    </div>
  )
}
