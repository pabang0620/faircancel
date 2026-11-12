import { useEffect, useState } from 'react'
import { api, storage } from './api.js'
import JudgePage from './components/JudgePage.jsx'
import SubscriberPage from './components/SubscriberPage.jsx'
import MerchantPage from './components/MerchantPage.jsx'

export default function App() {
  const [sessionId, setSessionId] = useState(() => storage.get()?.sessionId || null)

  useEffect(() => {
    if (sessionId) return
    api.createSession().then((s) => { storage.set({ ...(storage.get() || {}), sessionId: s.sessionId }); setSessionId(s.sessionId) })
  }, [sessionId])

  if (!sessionId) return <p className="boot">Starting...</p>
  const path = window.location.pathname
  if (path.startsWith('/account/subscription')) return <SubscriberPage sessionId={sessionId} />
  if (path.startsWith('/merchant')) return <MerchantPage sessionId={sessionId} />
  return <JudgePage sessionId={sessionId} />
}
