// PayPal Sandbox seed tooling. RUN BY A PERSON after approval; the app and the tests never call it.
//   node scripts/seedLive.js plan          create the $9/week product + plan (Agent Toolkit)
//   node scripts/seedLive.js create <n>    create n subscriptions, write approval links
//   node scripts/seedLive.js collect       move approved + paid subscriptions into data/seeds.json
// Approval of each link is done by the sandbox buyer (scripts/approveSeeds.py or by hand).
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createLiveClient } from '../server/paypal/liveClient.js'

const DATA = process.env.DATA_DIR || 'data'
const file = (name) => path.join(DATA, name)
const read = (name, fallback) => (existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : fallback)
const write = (name, value) => { mkdirSync(DATA, { recursive: true }); writeFileSync(file(name), JSON.stringify(value, null, 2)) }

if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) in .env first.')
  process.exit(1)
}
const pp = createLiveClient({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET })
const [command, arg] = process.argv.slice(2)

async function makePlan() {
  const product = await pp.toolkitCall('create_product', { name: 'Clay Studio weekly class pass', type: 'SERVICE', description: 'Fictional weekly online pottery class pass (FairCancel demo)' })
  const plan = await pp.toolkitCall('create_subscription_plan', {
    product_id: product.id,
    name: 'Weekly class pass, $9 per week',
    description: 'Weekly class pass',
    billing_cycles: [{ frequency: { interval_unit: 'WEEK', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { currency_code: 'USD', value: '9.00' } } }],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  })
  write('plan.json', { productId: product.id, planId: plan.id, createdAt: new Date().toISOString() })
  console.log('plan', plan.id, plan.status)
}

async function createSubs(n) {
  const plan = read('plan.json', null)
  if (!plan) throw new Error('Run "plan" first.')
  const pending = read('seeds.pending.json', [])
  for (let i = 0; i < n; i += 1) {
    const started = Date.now()
    const sub = await pp.toolkitCall('create_subscription', {
      plan_id: plan.planId,
      subscriber: { name: { given_name: 'Seed', surname: `Buyer${pending.length + 1}` } },
      application_context: { brand_name: 'Clay Studio (fictional)', user_action: 'SUBSCRIBE_NOW', return_url: 'https://example.com/return', cancel_url: 'https://example.com/cancel', payment_method: { payer_selected: 'PAYPAL', payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED' } },
    })
    const approve = sub.links?.find((l) => l.rel === 'approve')?.href
    pending.push({ subscriptionId: sub.id, approve, createdAt: new Date(started).toISOString() })
    console.log(sub.id, sub.status, approve)
  }
  write('seeds.pending.json', pending)
}

async function collect() {
  const pending = read('seeds.pending.json', [])
  const seeds = read('seeds.json', [])
  const remaining = []
  for (const item of pending) {
    try {
      const details = (await pp.showSubscription(item.subscriptionId)).data
      const txns = (await pp.listTransactions(item.subscriptionId)).data.transactions || []
      const paid = txns.find((t) => t.status === 'COMPLETED')
      if (details.status === 'ACTIVE' && paid) {
        const minutes = Math.round((Date.parse(paid.time) - Date.parse(item.createdAt)) / 60000)
        seeds.push({ subscriptionId: item.subscriptionId, createdAt: item.createdAt, paidAt: paid.time, minutesToFirstPayment: minutes })
        console.log('ready', item.subscriptionId, `first COMPLETED payment ${minutes} min after creation`)
      } else {
        remaining.push(item)
        console.log('waiting', item.subscriptionId, details.status, `${txns.length} transactions`)
      }
    } catch (err) {
      remaining.push(item)
      console.log('error', item.subscriptionId, err.message)
    }
  }
  write('seeds.json', seeds)
  write('seeds.pending.json', remaining)
  console.log(`${seeds.length} seeds ready, ${remaining.length} pending`)
}

if (command === 'plan') await makePlan()
else if (command === 'create') await createSubs(Math.min(Number(arg) || 1, 60))
else if (command === 'collect') await collect()
else console.log('usage: node scripts/seedLive.js plan | create <n> | collect')
