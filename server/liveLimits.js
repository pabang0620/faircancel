// Caps on live model runs. One "run" is one subscriber action (one offer request), not one tool turn.
// Per client IP per hour and per host per day, both on the injected clock. A refused run never counts.
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export const LIVE_LIMIT_REASON = 'live limit reached'
export const LIVE_ERROR_REASON = 'live model unavailable'

export function createLiveLimits({ perIpHour = 10, perDay = 150 } = {}) {
  const byIp = new Map()
  let day = []
  return {
    // Returns true and counts the run, or false and counts nothing.
    take(ip, now) {
      const recentDay = day.filter((t) => now - t < DAY_MS)
      const recentIp = (byIp.get(ip || '-') || []).filter((t) => now - t < HOUR_MS)
      day = recentDay
      byIp.set(ip || '-', recentIp)
      if (perDay > 0 && recentDay.length >= perDay) return false
      if (perIpHour > 0 && recentIp.length >= perIpHour) return false
      day = [...recentDay, now]
      byIp.set(ip || '-', [...recentIp, now])
      return true
    },
  }
}
