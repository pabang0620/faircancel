// S3, the first sandbox check. RUN BY A PERSON after approval; never run by the app or tests.
// Takes one seed that already has a COMPLETED payment and asks, without refunding anything:
//   1. does GET /v2/payments/captures/{subscription transaction id} answer 200?
// Only with --refund-one does it refund $0.01 through the v2 capture path, then (if that fails)
// through the v1 sale path, and prints which REFUND_PATH to set.
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createLiveClient } from '../server/paypal/liveClient.js'

const DATA = process.env.DATA_DIR || 'data'
const seeds = JSON.parse(readFileSync(path.join(DATA, 'seeds.json'), 'utf8'))
const pp = createLiveClient({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET })
const id = process.argv[2] || seeds.at(-1)?.subscriptionId
if (!id) { console.error('No seed. Run seedLive.js collect first.'); process.exit(1) }

const txns = (await pp.listTransactions(id)).data.transactions
const txn = txns.find((t) => t.status === 'COMPLETED')
console.log('subscription', id, 'transaction', txn.id, txn.amount_with_breakdown?.gross_amount)

let capture200 = false
try { await pp.getCapture(txn.id); capture200 = true } catch (err) { console.log('GET capture failed:', err.status, err.issue) }
console.log('capture lookup 200:', capture200)

if (process.argv.includes('--refund-one')) {
  const tries = [['v2capture', () => pp.refundCapture(txn.id, { amountCents: 1, note: 'FairCancel S3 check' })], ['v1sale', () => pp.refundSale(txn.id, { amountCents: 1, requestId: `s3-${txn.id}` })]]
  for (const [name, run] of tries) {
    try { const out = await run(); console.log(`REFUND_PATH=${name}  (refund id ${out.data.id}, status ${out.status})`); process.exit(0) } catch (err) { console.log(name, 'failed:', err.status, err.issue) }
  }
  console.log('Both refund paths failed. Stop and report before filming (PLAN 6-4).')
}
