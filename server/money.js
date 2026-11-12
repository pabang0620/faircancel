// All money is integer cents inside the server. Dollars only at the PayPal and screen edges.
export const toCents = (value) => Math.round(Number(value) * 100)
export const fromCents = (cents) => (cents / 100).toFixed(2)
export const usd = (cents) => `$${fromCents(cents)}`
