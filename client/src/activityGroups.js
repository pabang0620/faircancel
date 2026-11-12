// Collapses runs of identical read-only rows (the transactions GET that every screen load triggers)
// into one row with a count, so the write calls (suspend, cancel, refund) stay visible.
// Input and output are oldest first.
export function groupActivity(entries) {
  const out = []
  for (const entry of entries) {
    const last = out[out.length - 1]
    const same = last && entry.method === 'GET' && last.method === 'GET' && last.path === entry.path && last.status === entry.status && last.ok === entry.ok && last.backend === entry.backend
    if (same) out[out.length - 1] = { ...last, count: last.count + 1, at: entry.at }
    else out.push({ ...entry, count: 1 })
  }
  return out
}
