import { useCallback, useEffect, useState } from 'react'
import { api, storage } from '../api.js'
import SubscriberPanel from './SubscriberPanel.jsx'
import MerchantPanel from './MerchantPanel.jsx'

const SCENARIOS = [
  { n: 1, label: '1 Pause' },
  { n: 2, label: '2 Cancel' },
  { n: 3, label: '3 Full refund' },
  { n: 4, label: '4 Resume a paused one' },
]

const FILM = new URLSearchParams(window.location.search).get('film') === '1'

export default function JudgePage({ sessionId }) {
  const [health, setHealth] = useState(null)
  const [merchant, setMerchant] = useState(null)
  const [active, setActive] = useState(() => storage.get()?.active || null)
  const [notice, setNotice] = useState('')
  const [poolEmpty, setPoolEmpty] = useState(null)

  const refresh = useCallback(async () => {
    try { setMerchant(await api.merchant(sessionId)); setHealth(await api.health()) } catch { /* server restarting */ }
  }, [sessionId])

  useEffect(() => { refresh(); const t = setInterval(refresh, 2000); return () => clearInterval(t) }, [refresh])

  async function claim(scenario, allowLocal = false) {
    setNotice('')
    setPoolEmpty(null)
    try {
      const v = await api.claim(sessionId, scenario, allowLocal)
      setActive(v.id)
      storage.set({ ...(storage.get() || {}), active: v.id })
      refresh()
    } catch (err) {
      if (err.code === 'pool_empty') setPoolEmpty(scenario)
      else setNotice(err.message)
    }
  }

  async function sync(id) {
    try { await api.sync(sessionId, id); refresh() } catch (err) { setNotice(err.message) }
  }

  async function startOver() {
    setNotice('')
    setPoolEmpty(null)
    try {
      await api.resetSession(sessionId)
      setActive(null)
      storage.set({ ...(storage.get() || {}), active: null })
      refresh()
    } catch (err) { setNotice(err.message) }
  }

  const pool = health?.pool
  const mine = merchant?.subscriptions.find((s) => s.id === active)
  return (
    <div className="judge">
      <header className="top">
        <div className="brand"><strong>FairCancel</strong><span className="tag">Judge mode</span></div>
        <nav className="scenarios" aria-label="Scenarios">
          {SCENARIOS.map((s) => <button key={s.n} type="button" className="btn btn--scenario" onClick={() => claim(s.n)}>{s.label}</button>)}
          {FILM && pool ? <span className={`filmbadge ${pool.mode === 'sandbox' ? 'filmbadge--sandbox' : ''}`}>{pool.mode === 'sandbox' ? 'PayPal SANDBOX' : 'LOCAL MOCK'}</span> : null}
        </nav>
        <div className="top__status">
          <button type="button" className="btn btn--small" onClick={startOver} title="Remove your subscriptions and start again">Start over</button>{' '}
          {pool?.mode === 'local' ? <span className="strip">local mode, no PayPal calls</span> : <span className="strip strip--ok">{pool?.ready ?? '-'} sandbox subscriptions ready</span>}
        </div>
      </header>
      {poolEmpty ? (
        <p className="notice">All sandbox subscriptions are in use. <button type="button" className="link" onClick={() => claim(poolEmpty, true)}>Continue in local mode</button></p>
      ) : null}
      {notice ? <p className="notice" role="alert">{notice}</p> : null}
      {mine?.scenario === 1 && !mine.reason ? (
        <p className="notice notice--hint">Try a date ("Visiting family until a date you choose") or, on a new Pause, "Back after the holidays, my kid is home": keywords cannot read that one, a model can.</p>
      ) : null}
      <main className="split">
        {active ? <SubscriberPanel key={active} sessionId={sessionId} subscriptionId={active} merchantStatus={mine?.status} /> : (
          <section className="panel"><div className="panel__head"><h2>Subscriber</h2></div><p className="muted">Press a scenario button to get your own subscription.</p></section>
        )}
        <MerchantPanel data={merchant} onSync={sync} activeId={active} />
      </main>
      <footer className="foot">Not legal advice. Designed to follow Cal. Bus. &amp; Prof. Code &sect;17602(e)(2). Churnkey's rebates are Stripe only. FairCancel lets PayPal Subscriptions sellers stay on PayPal instead of moving to Stripe.</footer>
    </div>
  )
}
