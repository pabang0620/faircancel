import { DAY_MS } from './refundCalc.js'

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const SHORT = MONTHS.map((m) => m.slice(0, 3))

function monthIndex(word) {
  const w = word.toLowerCase()
  const full = MONTHS.indexOf(w)
  if (full >= 0) return full
  return SHORT.indexOf(w.slice(0, 3)) >= 0 && w.length <= 4 ? SHORT.indexOf(w.slice(0, 3)) : -1
}

// Day inside the month for words like "early", "mid", "late", "end of".
function dayFromQualifier(q) {
  if (!q) return 15
  if (/early|beginning|start/.test(q)) return 5
  if (/mid/.test(q)) return 15
  return 26
}

function nextOccurrence(month, day, now) {
  const base = new Date(now)
  let date = Date.UTC(base.getUTCFullYear(), month, day)
  if (date <= now) date = Date.UTC(base.getUTCFullYear() + 1, month, day)
  return date
}

const MONTH_WORDS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec'
const MONTH_RE = new RegExp(`\\b(early|mid|late|end of|beginning of|start of)?[\\s-]*(${MONTH_WORDS})\\b\\.?\\s*(\\d{1,2})?`, 'g')
const RETURN_WORDS = /(until|till|back|return|by|before|after|through|to)\b/
const PREPOSITION_BEFORE = /\b(until|till|by|before|after|through|to|in|of|from|during|every)\s*$/
// "may" is also a verb ("I may be back in 3 weeks"). It counts as the month only with a day number,
// a qualifier (mid-May) or a preposition right before it, and never when a verb follows.
const VERB_AFTER = /^\s*(be|not|have|need|want|come|go|take|also|just|like|still|stay|cancel|leave|return|join|try|get|do|even|only|actually|end|start|pause|resume)\b/

function isRealMonth(match, text) {
  if (!/^(may)$/i.test(match[2])) return true
  if (match[3] || match[1]) return true
  const before = text.slice(0, match.index + (match[0].length - match[0].trimStart().length))
  const after = text.slice(match.index + match[0].length)
  return PREPOSITION_BEFORE.test(before.trimEnd() + ' ') && !VERB_AFTER.test(after)
}

// "six weeks" reads like "6 weeks" (REVIEW_3 F6).
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

// Pulls a return time out of free text. Returns { weeks, returnAt, hint } or null.
// weeks is a real number (not yet snapped to the merchant menu).
// A month with no day: "mid-/early-/late-" pick that part of the month, "by/before <month>" means the
// first day of that month (the subscriber is back before it starts), otherwise the middle of the month.
export function parseReturnHint(text, now) {
  const t = String(text || '').toLowerCase()
  if (RETURN_WORDS.test(t)) {
    for (const dateMatch of t.matchAll(MONTH_RE)) {
      if (!isRealMonth(dateMatch, t)) continue
      const month = monthIndex(dateMatch[2])
      if (month < 0) continue
      const before = t.slice(0, dateMatch.index)
      const deadline = !dateMatch[1] && !dateMatch[3] && /\b(by|before)\s*$/.test(before)
      const day = dateMatch[3] ? Math.min(Number(dateMatch[3]), 28) : deadline ? 1 : dayFromQualifier(dateMatch[1])
      const returnAt = nextOccurrence(month, day, now)
      return { weeks: (returnAt - now) / (7 * DAY_MS), returnAt, hint: capitalizeMonths(dateMatch[0].trim()) }
    }
  }
  const weeksMatch = t.match(new RegExp(`\\b(\\d{1,2}|${NUMBER_WORDS.join('|')})\\s*(?:-|to)?\\s*(?:\\d{1,2})?\\s*weeks?`))
  if (weeksMatch) {
    const n = NUMBER_WORDS.includes(weeksMatch[1]) ? NUMBER_WORDS.indexOf(weeksMatch[1]) + 1 : Number(weeksMatch[1])
    return { weeks: n, returnAt: now + n * 7 * DAY_MS, hint: weeksMatch[0].trim() }
  }
  const monthsMatch = t.match(/(\d{1,2}|a|one|two|three)\s*months?/)
  if (monthsMatch) {
    const words = { a: 1, one: 1, two: 2, three: 3 }
    const n = words[monthsMatch[1]] || Number(monthsMatch[1])
    return { weeks: n * 4.35, returnAt: now + n * 30 * DAY_MS, hint: monthsMatch[0].trim() }
  }
  return null
}

function capitalizeMonths(text) {
  return text.replace(new RegExp(`\\b(${MONTH_WORDS})\\b`, 'g'), (m) => m[0].toUpperCase() + m.slice(1))
}

// Snaps a number of weeks to the closest menu value. A tie goes to the longer pause.
export function closestMenuWeeks(weeks, menu) {
  const sorted = [...menu].sort((a, b) => a - b)
  return sorted.reduce((best, value) => {
    const d = Math.abs(value - weeks)
    const bd = Math.abs(best - weeks)
    return d < bd || (d === bd && value > best) ? value : best
  }, sorted[0])
}

const TEMPORARY = /\b(back|return|temporar|break|vacation|holiday|travel|visit|away|exam|surgery|busy|later|pause|few weeks|trip|recover)/i

// The "rule card": keyword classifier. It can only say "temporary -> shortest pause".
export function ruleCard(reason, menu) {
  if (TEMPORARY.test(String(reason || ''))) return { type: 'pause', weeks: Math.min(...menu), source: 'rule' }
  return { type: 'none', source: 'rule' }
}

// Menu value for a return time, or null when the return is too far from anything on the menu
// (a pause of 8 weeks does not help someone who is gone for 17).
export function pauseWeeksFor(weeks, menu) {
  const max = Math.max(...menu)
  if (!(weeks > 0) || weeks > max * 1.5) return null
  return closestMenuWeeks(weeks, menu)
}
