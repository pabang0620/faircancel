# FairCancel (Devpost text)

Numbers on screen depend on the day the seed was charged and on today's date. Every dollar or week figure below is "for example".

## Inspiration

California's click-to-cancel rule is short: a business "may display a discounted offer, retention benefit, or information regarding the effects of cancellation, provided that the business simultaneously displays a prominently located and continuously and proximately displayed direct link or button entitled 'click to cancel,' or words to that effect... If the consumer utilizes this direct link or button, the business shall promptly process the cancellation and shall not otherwise obstruct or delay the consumer's ability to proceed to cancellation." (Cal. Bus. & Prof. Code section 17602(e)(2), for contracts entered, amended or extended from July 1, 2025.)

A small seller who bills with PayPal Subscriptions has no cancel page that does this. Kajabi says it plainly: "PayPal cancellations finish outside of Kajabi". Churnkey's rebates are Stripe only. We wanted the seller-side cancel screen that follows the rule and keeps the seller on PayPal. Not legal advice.

## What it does

A fictional seller, Clay Studio, sells a $9 per week pottery class pass on PayPal Subscriptions. The subscriber's cancel page always shows "Cancel now" and what cancelling means ("If you cancel now: refund $X") before anything else. Four scenarios in Judge mode:

1. Pause: the subscriber says why. At most one offer, always a pause (2, 4, 6 or 8 weeks from the merchant menu), never a discount. The Pause and Cancel now buttons are the same size. Pause is a real PayPal `suspend`; FairCancel resumes with `activate` on the date.
2. Cancel: no offer for "too expensive". Cancel now is a real PayPal `cancel`, and the unused days are refunded through PayPal. For example, one day after the payment: $9.00 x 6.0 of 7 days unused = $7.71.
3. Full refund: no class attended this week, so the full payment goes back (capped by anything already refunded).
4. Resume: a paused subscriber comes back in one click; a Sync button re-reads PayPal.

## How we built it

PayPal calls (all through one gateway that also writes the dashboard Activity list):

| Step | Call |
|---|---|
| Read state | `GET /v1/billing/subscriptions/{id}` (Agent Toolkit `show_subscription_details`) |
| Payments for the quote | `GET /v1/billing/subscriptions/{id}/transactions` |
| Pause / resume | `POST .../suspend`, `POST .../activate` |
| Cancel | `POST .../cancel` (Agent Toolkit `cancel_subscription`) |
| Refund | `POST /v2/payments/captures/{transaction id}/refund` (Agent Toolkit `create_refund`) |

Sandbox checks run on 2026-11-12 (see VERIFY.md): S3 a subscription transaction ID works as a v2 capture ID (PASS); S5 a SUSPENDED subscription can be cancelled directly (PASS); S9 the same `PayPal-Request-Id` does not refund twice (PASS); S4 suspend then activate keeps the billing date and charges nothing (PASS, API side); V14 the capture does not report a refunded total (FAIL), so a retry whose answer was lost ends as "refund by hand" and sends no second refund. Money is moved only by server code under a per-subscription lock; the refund is floor(amount x unused time / 7 days) from the latest COMPLETED payment.

The AI: seven tools (`get_subscription_state`, `list_recent_payments`, `get_usage_record`, `get_policy`, `quote_refund`, `propose_offer`, `answer_subscriber`), none of which can pause, cancel or refund. The model reads a return time out of free text, including sentences keywords cannot read ("Back after the holidays, my kid is home"), and proposes a pause length. The server checks it against the merchant menu, drops any quoted words that are not the subscriber's own, and throws away any dollar figure that is not its own. The dashboard shows the keyword rule card next to the model's pick. Cancel now never waits for the model.

## Challenges

PayPal does not give a resume date on suspend (we schedule `activate`), has no automatic pro-rata refund on cancel (a calculator in code does it), and the capture does not show the refunded total (V14). We kept every one of these visible in the README instead of hiding them.

## Built with

PayPal Subscriptions API, PayPal Agent Toolkit 1.11, Claude (`claude-sonnet-5-5`), Node.js, Express, React 19, Vite, zod.

## Testing instructions

No PayPal login needed.

1. Open `/judge`. The top shows "N sandbox subscriptions ready" (or the local mode strip).
2. Button 2 Cancel: note the refund line under Cancel now. Type "too expensive" and Send: no offer. Press Cancel now: CANCELLED, the formula, the refund ID and the PayPal calls in the Activity list.
3. Button 1 Pause: type "Visiting family until mid-January, then I'll be back". The dashboard shows the rule card next to the agent's pick and the card says "(you said mid-January)". Press Pause: SUSPENDED.
4. Button 1 Pause again, type "Back after the holidays, my kid is home": the rule card says pause 2 weeks, the model picks a longer menu value and quotes your words.
5. Button 3 Full refund: type "I was charged yesterday but couldn't make any class this week"; Cancel now refunds the full payment.
6. Button 4 Resume a paused one: Resume now, then Sync.

Not legal advice. MIT licensed.
