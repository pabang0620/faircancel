// PASS items from VERIFY.md (run 2026-11-12). Only PASS rows are listed; a test checks each ID against VERIFY.md.
// Open or failed items (S7, S10, V13, V14) are not claimed here.
export const SANDBOX_EVIDENCE_DATE = '2026-11-12'

export const SANDBOX_EVIDENCE = [
  { id: 'S11', text: 'This Judge page on sandbox subscriptions: cancel 204, suspend 204, activate 204, refund 201; refund IDs 5N302748GW6167052 ($8.99) and 7G227583162043728 ($9.00) read back COMPLETED from PayPal' },
  { id: 'S3', text: 'A subscription transaction ID works as a v2 capture ID; v2 refund 201' },
  { id: 'S5', text: 'A SUSPENDED subscription can be cancelled directly (cancel 204)' },
  { id: 'S9', text: 'The same PayPal-Request-Id does not refund twice (v1 and v2)' },
  { id: 'S4', text: 'suspend 204 then activate 204: billing date kept, no new charge (API side)' },
  { id: 'S8', text: 'Agent Toolkit cancel_subscription 204, status CANCELLED' },
  { id: 'V15', text: 'Wrong-state cancel returns 422 "Invalid subscription status", matched by the code' },
  { id: 'S1', text: '5 of 5 seeds approved one after another, 32 to 50 s each' },
  { id: 'S2', text: 'First payment COMPLETED seconds after approval' },
  { id: 'S6', text: '5 subscriptions on one plan for one buyer, no limit hit' },
  { id: 'V11', text: 'last_payment.time equals the transaction time' },
  { id: 'V12', text: 'The 45-day transactions window returns the latest payment' },
  { id: 'C1', text: 'Claude Sonnet (local account) tool loop: tool order as asked, menu values only' },
]
