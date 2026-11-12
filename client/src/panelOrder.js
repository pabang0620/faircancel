// Ordering and emphasis helpers for the merchant dashboard (pure, so the tests can run them).

// Newest decision first, so the line the viewer is watching is never pushed below older scenarios.
export function orderDecisions(decisions) {
  return [...decisions].sort((a, b) => String(b.shownAt || '').localeCompare(String(a.shownAt || '')))
}

export function subRowClass(sub, activeId) {
  return activeId && sub.id === activeId ? 'sublist__row sublist__row--current' : 'sublist__row'
}

export function decisionClass(decision, activeId) {
  return activeId && decision.subscriptionId === activeId ? 'decision decision--current' : 'decision'
}

// Rows of other subscriptions stay visible but fade, once one subscription is the current one.
export function activityClass(entry, activeId) {
  const classes = []
  if (!entry.ok) classes.push('activity--fail')
  if (activeId && entry.subscriptionId && entry.subscriptionId !== activeId) classes.push('activity--dim')
  return classes.join(' ')
}
