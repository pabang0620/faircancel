import { fmtDate, fmtDateTime } from '../api.js'
import StatusBadge from './StatusBadge.jsx'
import { groupActivity } from '../activityGroups.js'
import { SANDBOX_EVIDENCE, SANDBOX_EVIDENCE_DATE } from '../sandboxEvidence.js'
import { orderDecisions, subRowClass, decisionClass, activityClass } from '../panelOrder.js'

const offerText = (o) => (!o ? '-' : o.type === 'pause' ? `pause ${o.weeks} weeks${o.returnHint ? ` (you said ${o.returnHint})` : ''}` : 'no offer')
const agentName = (kind, rec) => (kind === 'recorded' && rec ? `Recorded run: ${rec.modelLabel}, ${rec.date}` : kind === 'claude' ? 'Agent (Claude)' : kind === 'claude-account' ? 'Agent (Claude Sonnet, local account)' : kind === 'custom' ? 'Agent' : 'Agent (rule-based stand-in)')
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`
const WRITE_LABELS = { cancel: 'Cancel subscription', suspend: 'Pause (suspend)', activate: 'Resume (activate)', refundCapture: 'Refund (v2 capture)', refundSale: 'Refund (v1 sale)' }

export default function MerchantPanel({ data, onSync, activeId = null }) {
  if (!data) return <section className="panel panel--merchant"><div className="panel__head"><h2>Behind the counter</h2></div><p className="muted">Loading...</p></section>
  const { policy } = data
  // The PayPal calls that changed something for the subscription on screen, oldest first.
  const writes = activeId ? data.activity.filter((a) => a.subscriptionId === activeId && WRITE_LABELS[a.op]) : []
  return (
    <section className="panel panel--merchant" aria-label="Merchant dashboard">
      <div className="panel__head">
        <h2>Behind the counter</h2>
        <p className="panel__sub">Merchant dashboard: what {policy.merchantName} sees</p>
      </div>

      <div className="rc">
        <h3>Subscriptions</h3>
        {data.subscriptions.length === 0 ? <p className="muted small">Pick a scenario above to get a subscription.</p> : (
          <ul className="sublist">
            {data.subscriptions.map((s) => (
              <li key={s.id} className={subRowClass(s, activeId)}>
                <span className="mono">{s.id}</span>
                <span>{s.name}</span>
                <StatusBadge status={s.status} />
                <button type="button" className="btn btn--small" onClick={() => onSync(s.id)}>Sync</button>
                {s.refundState === 'failed' ? <p className="error small syncinfo">Refund failed: {s.refundError}. FairCancel stopped trying. Refund by hand.</p> : null}
                {s.refundState === 'retrying' ? <p className="muted small syncinfo">Waiting for PayPal, will try again.</p> : null}
                {s.lastSync ? (
                  <p className="muted small syncinfo">Synced {fmtDateTime(s.lastSync.syncedAt)}: PayPal says <strong>{s.lastSync.paypalStatus || '-'}</strong>, local {s.lastSync.status}, next billing {s.lastSync.nextBillingTime ? fmtDate(s.lastSync.nextBillingTime) : 'none'}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {writes.length ? (
        <div className="rc">
          <h3>What PayPal did</h3>
          <ul className="did">
            {writes.map((a) => (
              <li key={a.id}>
                <strong>{WRITE_LABELS[a.op]}</strong> <span className={`code ${a.ok ? 'code--ok' : 'code--fail'}`}>{a.status}</span>
                <span className="mono muted did__path">{a.method} {a.path}</span>
                {a.ref ? <span className="mono did__ref">{a.ref}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rc">
        <h3>How FairCancel decided</h3>
        {data.agent?.mode === 'claude'
          ? <p className="agent-note agent-note--live">Agent: Claude ({data.agent.model}) is answering.</p>
          : data.agent?.mode === 'claude-account'
          ? <p className="agent-note agent-note--live">Agent: Claude Sonnet (local account, {data.agent.model}) is answering. Development run, not the hosted API.</p>
          : data.agent?.recorded?.length
          ? <p className="agent-note">No model is called in local mode. For the {data.agent.recorded.length} sentences listed in the README under "Recorded runs", "Agent" replays a recorded real run ({data.agent.recorded[0].modelLabel} through a local Claude Code account, {data.agent.recorded[0].date}): the same tool calls in the same order on this subscription, then the same server checks. Any other sentence goes to the rule-based stand-in, a program that makes the same tool calls.</p>
          : <p className="agent-note">No model key is set, so "Agent" below is the rule-based stand-in: it makes the same tool calls but a program, not a model, reads the reason.</p>}
        {data.decisions.length === 0 ? <p className="muted small">Type a reason on the subscriber side.</p> : orderDecisions(data.decisions).map((d) => (
          <div key={d.subscriptionId} className={decisionClass(d, activeId)}>
            <p className="decision__reason">&ldquo;{d.reason}&rdquo;</p>
            <div className="vs">
              <div className="vs__rule">Rule<b>{offerText(d.rule)}</b></div>
              <div className="vs__agent">{agentName(d.agentKind, d.recorded)}<b>{d.agentLate ? 'too slow, rule used' : offerText(d.agent)}</b></div>
            </div>
            <p className="mono small">{d.steps.map((s) => s.tool).join(' -> ')}</p>
            <p className="muted small">{d.steps.filter((s) => s.summary).map((s) => `${s.tool}: ${s.summary}`).join('; ')}</p>
            {d.recorded ? <p className="muted small">The model took {secs(d.recorded.totalMs)} in the recorded run on {d.recorded.today}. Replayed here, not called.</p> : null}
            <p className="small">Shown to subscriber: <strong>{offerText(d.shown)}</strong> ({d.source})</p>
          </div>
        ))}
      </div>

      <div className="rc">
        <h3>Activity</h3>
        <p className="rc__sub">Every PayPal call, newest first</p>
        <ol className="activity" aria-live="polite">
          {data.activity.length === 0 ? <li className="muted small">PayPal calls appear here.</li> : groupActivity(data.activity).reverse().map((a) => (
            <li key={a.id} className={activityClass(a, activeId)}>
              <span className="mono activity__path">{a.method} {a.path}</span>
              {a.count > 1 ? <span className="activity__count">x{a.count}</span> : null}
              <span className={`code ${a.ok ? 'code--ok' : 'code--fail'}`}>{a.status}</span>
              <span className="muted small">{a.via} {a.backend === 'local' ? '(local)' : '(sandbox)'}</span>
              {a.ref ? <button type="button" className="idcopy mono" title="Copy the PayPal ID" onClick={() => navigator.clipboard?.writeText(a.ref)}>{a.ref}</button> : null}
            </li>
          ))}
        </ol>
      </div>

      <div className="rc policy">
        <h3>Policy</h3>
        <p><span className="lock" aria-hidden="true">locked</span> {policy.stateRule.label}</p>
        <p className="muted small">Cancel now always on screen, cancel processed at once. The merchant cannot turn this off.</p>
        <p><strong>{policy.merchantName}:</strong> pause menu {policy.pauseMenuWeeks.join('/')} weeks, {policy.refundMode === 'prorate' ? 'refund unused days' : 'access until period end'}, {policy.fullRefundIfNoUsage ? 'full refund if no class attended' : 'no full-refund rule'}. Set {fmtDateTime(policy.setAt)}.</p>
        <p className="muted small">House rules: one offer at most, a pause only, never a discount.</p>
      </div>

      <details className="rc evidence">
        <summary><strong>Sandbox evidence</strong> <span className="muted small">PASS items from VERIFY.md, {SANDBOX_EVIDENCE_DATE}</span></summary>
        <ul className="small">
          {SANDBOX_EVIDENCE.map((e) => <li key={e.id}><span className="mono">{e.id}</span> PASS: {e.text}</li>)}
        </ul>
        <p className="muted small">Still open: the 7-day renewal (S7). V14 failed: the capture shows no refunded total, so a lost refund answer ends as "refund by hand".</p>
      </details>

      {data.reasonSummary.length ? (
        <div className="rc">
          <h3>Why people leave</h3>
          <ul className="reasons">
            {data.reasonSummary.map((r) => <li key={r.key}><strong>{r.label}</strong> x{r.count} <span className="muted small">&ldquo;{r.example}&rdquo;</span></li>)}
          </ul>
        </div>
      ) : null}
      {data.subscriptions.some((s) => s.resumeAt) ? <p className="muted small">Next scheduled resume {fmtDate(data.subscriptions.find((s) => s.resumeAt).resumeAt)}</p> : null}
    </section>
  )
}
