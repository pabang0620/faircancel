import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import MerchantPanel from './MerchantPanel.jsx'

export default function MerchantPage({ sessionId }) {
  const [data, setData] = useState(null)
  const refresh = useCallback(() => api.merchant(sessionId).then(setData).catch(() => null), [sessionId])
  useEffect(() => { refresh(); const t = setInterval(refresh, 2000); return () => clearInterval(t) }, [refresh])
  const sync = (id) => api.sync(sessionId, id).then(refresh).catch(() => null)
  return <div className="solo"><MerchantPanel sessionId={sessionId} data={data} onSync={sync} /></div>
}
