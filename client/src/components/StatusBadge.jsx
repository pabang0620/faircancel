// Big, high-contrast state badge. The key restarts the flash animation each time the state flips.
export default function StatusBadge({ status, large = false }) {
  return (
    <span key={status} className={`badge badge--${String(status).toLowerCase()} ${large ? 'badge--large' : ''}`} role="status">
      {status}
    </span>
  )
}
