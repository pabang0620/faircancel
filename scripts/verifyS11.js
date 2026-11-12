// S11 cross-check. RUN BY A PERSON after scripts/walkJudge.py on a sandbox server.
//   node scripts/verifyS11.js <walk_log.json>
// Re-reads, straight from the PayPal sandbox API (not through the app), every subscription the walk used and every
// refund ID the app showed, and prints one line each: what the app said next to what PayPal says.
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createLiveClient } from '../server/paypal/liveClient.js'

const file = process.argv[2]
if (!file || !process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  console.error('usage: node scripts/verifyS11.js <walk_log.json>, with sandbox keys in .env')
  process.exit(1)
}
const { merchant } = JSON.parse(readFileSync(file, 'utf8'))
const pp = createLiveClient({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET })
let mismatches = 0
const out = (line) => process.stdout.write(`${line}\n`)

for (const sub of merchant.subscriptions) {
  const paypal = (await pp.rest('GET', `/v1/billing/subscriptions/${sub.id}`)).data.status
  if (paypal !== sub.status) mismatches += 1
  out(`subscription ${sub.id} app=${sub.status} paypal=${paypal} ${paypal === sub.status ? 'MATCH' : 'MISMATCH'}`)
}
for (const row of merchant.activity.filter((a) => a.ref && /refund$/.test(a.path))) {
  const refund = (await pp.rest('GET', `/v2/payments/refunds/${row.ref}`)).data
  const capture = row.path.split('/')[4]
  const up = refund.links?.find((l) => l.rel === 'up')?.href || ''
  const ok = refund.id === row.ref && up.endsWith(capture)
  if (!ok) mismatches += 1
  out(`refund ${row.ref} app=${row.status} paypal=${refund.status} ${refund.amount?.value} ${refund.amount?.currency_code} capture=${capture} ${ok ? 'MATCH' : 'MISMATCH'}`)
}
out(`mismatches ${mismatches}`)
process.exit(mismatches ? 2 : 0)
