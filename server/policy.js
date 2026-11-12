import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

// Two layers. The state layer is law-derived and locked: the merchant cannot edit it.
// The merchant layer is Clay Studio's own choices, enforced by code.
export const STATE_RULE_LAYER = Object.freeze({
  id: 'CA-BPC-17602-e2',
  label: 'California click-to-cancel (designed to follow Cal. Bus. & Prof. Code 17602(e)(2))',
  locked: true,
  cancelNowAlwaysVisible: true,
  processCancelImmediately: true,
})

// Our own choices, stricter than the statute. Fixed in code, not merchant settings.
export const HOUSE_RULES = Object.freeze({ maxOffersPerSubscription: 1, offerTypes: Object.freeze(['pause']), discounts: false })

export const DEFAULT_MERCHANT_POLICY = Object.freeze({
  merchantName: 'Clay Studio',
  pauseMenuWeeks: Object.freeze([2, 4, 6, 8]),
  refundMode: 'prorate',
  fullRefundIfNoUsage: true,
})

// .strict() rejects any attempt to touch the state layer (for example cancelNowAlwaysVisible=false).
export const merchantPolicyPatchSchema = z.object({
  refundMode: z.enum(['prorate', 'access_until_end']).optional(),
  fullRefundIfNoUsage: z.boolean().optional(),
  pauseMenuWeeks: z.array(z.number().int().min(1).max(26)).min(1).max(6).optional(),
}).strict()

export function createPolicyStore({ file = null, clock = { now: () => Date.now() } } = {}) {
  let merchant = { ...DEFAULT_MERCHANT_POLICY, pauseMenuWeeks: [...DEFAULT_MERCHANT_POLICY.pauseMenuWeeks] }
  let setAt = new Date(clock.now()).toISOString()
  if (file && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      merchant = { ...merchant, ...saved.merchant }
      setAt = saved.setAt || setAt
    } catch { /* unreadable policy file: keep defaults */ }
  } else if (file) persist()

  function persist() {
    if (!file) return
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ merchant, setAt }, null, 2))
  }

  return {
    // The returned object always has the locked layer untouched, whatever was stored.
    get() {
      return { state: STATE_RULE_LAYER, house: HOUSE_RULES, merchant: { ...merchant, pauseMenuWeeks: [...merchant.pauseMenuWeeks].sort((a, b) => a - b) }, setAt }
    },
    update(patch) {
      const parsed = merchantPolicyPatchSchema.parse(patch)
      merchant = { ...merchant, ...parsed }
      setAt = new Date(clock.now()).toISOString()
      persist()
      return this.get()
    },
  }
}
