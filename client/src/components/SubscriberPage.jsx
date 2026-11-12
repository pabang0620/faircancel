import { storage } from '../api.js'
import SubscriberPanel from './SubscriberPanel.jsx'

// Subscriber-only view at /account/subscription: the page a seller would link from their site.
export default function SubscriberPage({ sessionId }) {
  const active = storage.get()?.active
  return (
    <div className="solo">
      {active ? <SubscriberPanel sessionId={sessionId} subscriptionId={active} /> : (
        <p className="notice">No subscription yet. <a href="/judge">Open Judge mode</a> and pick a scenario.</p>
      )}
    </div>
  )
}
