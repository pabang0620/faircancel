import { fmtDateTime } from '../api.js'

const usd = (cents) => `$${(cents / 100).toFixed(2)}`

// The money moment: what happened, the formula, where the money is, and who decided each part.
export default function ResultCard({ view }) {
  const result = view.result
  if (!result) return null
  if (result.kind === 'queued') {
    return <div className="card card--warn"><div className="card__body"><p className="card__title">{result.message}</p><p className="card__text">Cancel now is still here if you want to try again.</p></div></div>
  }
  const q = result.quote
  const refund = result.refund
  const local = view.backend === 'local'
  return (
    <div className="card card--result">
      <div className="done__seal" aria-hidden="true">&#10003;</div>
      <h3 className="done__title">
        You are cancelled.
        {refund ? <><br /><em>{refund.amountLabel}</em> {local ? 'refund recorded (mock).' : 'is on its way back.'}</> : null}
      </h3>
      <p className="done__sub">{local ? 'Cancelled in the local stand-in (mock). No PayPal call was made.' : 'Cancelled on PayPal. No further charges.'}</p>
      {refund ? (
        <>
          <p className="result__formula num">{q.formula}</p>
          <p className="done__meta">
            Cancelled {fmtDateTime(result.cancelledAt)} &middot;{' '}
            {local ? (
              <>Refund {refund.amountLabel} recorded locally (mock, nothing was sent to PayPal). Local reference <span className="mono">{refund.id}</span></>
            ) : (
              <>Refund {refund.amountLabel} sent via PayPal ({refund.path}, {refund.id ? <>ID <span className="mono">{refund.id}</span></> : 'confirmed on the capture, PayPal ID not received'})</>
            )}
          </p>
          <MoneyTrack q={q} refund={refund} local={local} merchantName={view.merchantName} />
        </>
      ) : (
        <>
          <p className="done__meta">Cancelled {fmtDateTime(result.cancelledAt)}</p>
          {result.phase === 'refund_waiting' ? (
            <p className="done__text">{result.message}</p>
          ) : result.phase === 'refund_failed' ? (
            <p className="done__text done__text--fail">The refund could not be sent automatically and FairCancel has stopped trying. {view.merchantName} has been told to refund it by hand.</p>
          ) : (
            <p className="done__text">{q.message || 'No refund is due under the merchant policy.'}</p>
          )}
        </>
      )}
      <div className="who">
        <div><b>Pressed Cancel now</b>{view.subscriberName ? `${view.subscriberName} (subscriber), ` : ''}{fmtDateTime(result.requestedAt)}. No second confirm step.</div>
        <div><b>Set the refund rule</b>Refund rule set by {result.policy.by} on {fmtDateTime(result.policy.setAt)}</div>
        <div><b>Worked out {refund ? refund.amountLabel : 'the refund'}</b>Server code from PayPal transactions, never the AI.</div>
      </div>
    </div>
  )
}

// Where the money is, step by step. Built only from the payment and the refund record the server returned.
function MoneyTrack({ q, refund, local, merchantName }) {
  const paid = Number.isFinite(q.paidCents) ? q.paidCents : null
  const done = refund.status === 'COMPLETED'
  return (
    <div className="track" aria-label="Where the money is">
      {paid !== null ? <div className="track__step track__step--captured">Captured<b>{usd(paid)}</b>{q.paidAt ? `${fmtDateTime(q.paidAt)} weekly charge` : 'weekly charge'}</div> : null}
      <div className="track__step track__step--pending">{local ? 'Refund recorded (mock)' : 'Refund sent'}<b>{refund.amountLabel}</b>{fmtDateTime(refund.at)} {refund.path}</div>
      <div className={`track__step ${done ? 'track__step--refunded' : 'track__step--pending'}`}>{done ? 'Refunded' : `Refund ${String(refund.status || 'pending').toLowerCase()}`}<b>{refund.amountLabel}</b>{refund.id ? <span className="mono">{refund.id}</span> : 'confirmed on the capture'}</div>
      {paid !== null ? <div className="track__step track__step--kept">{merchantName} keeps<b>{usd(Math.max(paid - refund.amountCents, 0))}</b>{paid > refund.amountCents ? 'for the days used' : 'nothing kept'}</div> : null}
    </div>
  )
}
