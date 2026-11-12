// Groups the reasons subscribers typed into themes for the merchant. Plain keyword grouping,
// no model call. Names are never included.
const THEMES = [
  { key: 'price', label: 'Price', test: /expensive|pricey|afford|cost|too much|budget/i },
  { key: 'away', label: 'Away for a while', test: /back|return|vacation|holiday|visit|surgery|exam|trip|travel|break|busy/i },
  { key: 'billing', label: 'Charge questions', test: /charged|billed|refund/i },
  { key: 'not_using', label: 'Not using it', test: /not using|never use|don'?t use|quit|moving|lost interest/i },
]

export function summarizeReasons(subs) {
  const groups = new Map()
  for (const sub of subs.filter((s) => s.reason)) {
    const theme = THEMES.find((t) => t.test.test(sub.reason)) || { key: 'other', label: 'Other' }
    const group = groups.get(theme.key) || { key: theme.key, label: theme.label, count: 0, example: sub.reason.slice(0, 120) }
    groups.set(theme.key, { ...group, count: group.count + 1 })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}
