# FairCancel (Devpost text)

Numbers on screen depend on the day the seed was charged and on today's date. Every dollar or week figure from the app below is "for example".

## Inspiration

California's click-to-cancel rule is short: if a consumer cancels online, the business "may display a discounted offer, retention benefit, or information regarding the effects of cancellation, provided that the business simultaneously displays a prominently located and continuously and proximately displayed direct link or button entitled 'click to cancel,' or words to that effect... If the consumer utilizes this direct link or button, the business shall promptly process the cancellation and shall not otherwise obstruct or delay the consumer's ability to proceed to cancellation." (Cal. Bus. & Prof. Code section 17602(e)(2); it applies to "a contract entered into, amended, or extended under this article on or after July 1, 2025", section 17602(j). Source: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17602. , same text at https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-17602/.) Not legal advice.

A small seller who bills with PayPal Subscriptions has no ready cancel page that does this. Kajabi says it plainly: "PayPal cancellations finish outside of Kajabi" (https://help.kajabi.com/en/articles/17175923). Churnkey's native billing providers are Stripe, Chargebee, Paddle and Braintree (https://docs.churnkey.co/billing-providers/payment-provider-overview), and its rebates are "Stripe only" (https://docs.churnkey.co/cancel-flows/offers/rebate). PayPal gives the pieces, a suspend call meant to "reduce customer churn" without a "hard cancellation" (https://developer.paypal.com/subscriptions/pause-or-resume), but not the subscriber screen. We built that screen.

## Who it is for

The first user is a one-person seller of a weekly or monthly class pass who bills with PayPal Subscriptions on their own site and sells to customers in California.

## The problem, with numbers

- The law above requires a "click to cancel" button that stays on screen beside any offer and works at once.
- Subscribers want a pause, and few get one: "55% of consumers identify the ability to pause their subscriptions as their top feature", but "only 37% report that their current services actually offer a pause option" (Recurly with Hanover Research, 1,000 subscription consumers; vendor research: https://recurly.com/blog/the-pause-button-your-best-retention-tool). The same page says businesses with a pause option "have seen 25% of their subscribers choose to pause instead of cancelling".
- When a customer has a problem with a charge they usually skip the seller: "In all dispute types, consumers bypass the merchant in most cases (75%)", and when they do contact the merchant first, merchants resolve it by "issuing a refund or replacement (31%) or by simply answering the customer's question (44%)" (Mastercard and Javelin, 2026 Chargebacks white paper, all dispute types, not only subscriptions: https://www.mastercard.com/content/dam/mccom/shared/news-and-trends/insights/2026/2026-javelin-chargebacks-white/2026%20Chargebacks%20Javelin%20White%20Paper.pdf). A cancel page that refunds unused days on the spot gives the subscriber a reason to come to the seller first.

## What it does

A fictional seller, Clay Studio, sells a $9 per week pottery class pass on PayPal Subscriptions. The subscriber's cancel page always shows "Cancel now" and what cancelling means ("If you cancel now: refund $X") before anything else.

- Pause: at most one offer, always a pause (2, 4, 6 or 8 weeks from the merchant menu), never a discount. The Pause and Cancel now buttons are the same size. Pause is a PayPal `suspend`; FairCancel calls `activate` on the resume date.
- Cancel: no offer for "too expensive". Cancel now is a PayPal `cancel`, and the unused days are refunded through PayPal, for example one day after the payment: $9.00 x 5.99 of 7 days unused = $7.70.
- Full refund: no class attended this week, so the full payment goes back (capped by anything already refunded).
- Resume: a paused subscriber comes back in one click; a Sync button re-reads PayPal.

## Why this is good for PayPal

- Merchant volume: today a PayPal Subscriptions seller who wants a compliant cancel flow with a pause or a partial refund is pointed to tools built around Stripe. FairCancel keeps that seller, and the recurring volume, on PayPal.
- Risk: a subscriber who can pause or get unused days back in one click on the seller's page has less reason to file a dispute. That means fewer chargebacks for PayPal sellers and for PayPal.
- A product PayPal could ship: a hosted "cancel and pause" page for Subscriptions, like the hosted checkout, built on the existing `suspend`, `activate`, `cancel` and refund APIs plus a server-side pro-rata calculator, with the click-to-cancel button locked on.

## What the demo proves today, and what needs PayPal or partners

Proves today (VERIFY.md, run 2026-11-12):
- S3 PASS: a subscription transaction ID works as a v2 capture ID, so unused days are refunded with `POST /v2/payments/captures/{id}/refund`.
- S5 PASS: a SUSPENDED subscription can be cancelled directly.
- S9 PASS: the same `PayPal-Request-Id` does not refund twice.
- S4 PASS (API side): suspend then activate keeps the billing date and charges nothing.
- S8 and V15 PASS: Agent Toolkit `cancel_subscription` and its wrong-state error text.
- C1 PASS: Claude Sonnet, through a local Claude Code account, calls the tools in the expected order and picks only menu values.
- 87 automated tests (money, state changes, locks, session isolation) on stand-ins.

Proven on the sandbox on 2026-11-12: the whole Judge page on real sandbox subscriptions (S11): cancel 204, suspend 204, activate 204, refund 201, and the refund IDs it showed (5N302748GW6167052 for $8.99, 7G227583162043728 for $9.00) read back COMPLETED from the PayPal API. Not yet proven: webhooks (S10, needs a public host), the 7-day renewal (S7), the hosted API model path. V14 failed: the capture does not show a refunded total, so a refund whose answer was lost ends as "refund by hand" and sends no second refund.

Needs PayPal or partners: a resume date on suspend (today we schedule `activate`), a refunded total on the capture, and a hosted subscriber page.

## How we built it

PayPal calls (all through one gateway that also writes the dashboard Activity list):

| Step | Call |
|---|---|
| Read state | `GET /v1/billing/subscriptions/{id}` (Agent Toolkit `show_subscription_details`) |
| Payments for the quote | `GET /v1/billing/subscriptions/{id}/transactions` |
| Pause / resume | `POST .../suspend`, `POST .../activate` |
| Cancel | `POST .../cancel` (Agent Toolkit `cancel_subscription`) |
| Refund | `POST /v2/payments/captures/{transaction id}/refund` (Agent Toolkit `create_refund`) |

Money is moved only by server code under a per-subscription lock; the refund is floor(amount x unused time / 7 days) from the latest COMPLETED payment.

The AI: seven tools (`get_subscription_state`, `list_recent_payments`, `get_usage_record`, `get_policy`, `quote_refund`, `propose_offer`, `answer_subscriber`), none of which can pause, cancel or refund. The model decides which lookups it needs: a billing complaint gets payments, attendance and the quote; a return time gets the subscription state. It reads a return time out of free text, including sentences keywords cannot read ("Back after the holidays, my kid is home"), and proposes a pause length. The server checks it against the merchant menu, drops any quoted words that are not the subscriber's own, and throws away any dollar figure that is not its own. The dashboard shows the keyword rule card next to the model's pick. Cancel now never waits for the model.

Real model runs: the four Testing-instructions sentences were run once each through Claude Sonnet (`claude-sonnet-5-5`) with a local Claude Code account on 2026-11-12 and saved with their tool calls, text and timings (5.3 to 7.8 s). The public demo runs without keys, so it replays those recordings for those exact sentences, labelled "Recorded run: Claude Sonnet, 2026-11-12", and still applies the server checks. Any other sentence goes to a rule-based stand-in that says so.

## Challenges

PayPal does not give a resume date on suspend (we schedule `activate`), has no automatic pro-rata refund on cancel (a calculator in code does it), and the capture does not show the refunded total (V14). We kept every one of these visible in the README instead of hiding them.

## Built with

PayPal Subscriptions API, PayPal Agent Toolkit 1.11, Claude Sonnet (`claude-sonnet-5-5`, through the Anthropic SDK or the Claude Agent SDK), Node.js, Express, React 19, Vite, zod.

## Testing instructions

No PayPal login needed. `cp .env.example .env`, `npm install`, `npm run build`, `npm start`, then open `http://localhost:3002/judge`.

1. Open `/judge`. The top shows "N sandbox subscriptions ready" (or the local mode strip).
2. Button 2 Cancel: note the refund line under Cancel now. Type "too expensive" and Send: no offer. Press Cancel now: CANCELLED, the formula, the refund ID and the PayPal calls in the Activity list.
3. Button 1 Pause: type "Visiting family until mid-January, then I'll be back". The dashboard shows the rule card next to the agent's pick and the card says "(you said mid-January)". Press Pause: SUSPENDED.
4. Button 1 Pause again, type "Back after the holidays, my kid is home": the rule card says pause 2 weeks, the model picks a longer menu value and quotes your words. Without keys the chip says "Recorded run: Claude Sonnet, 2026-11-12".
5. Button 3 Full refund: type "I was charged yesterday but couldn't make any class this week"; Cancel now refunds the full payment.
6. Button 4 Resume a paused one: Resume now, then Sync.

The "Sandbox evidence" box in the merchant dashboard lists the PASS items from VERIFY.md.

Not legal advice. MIT licensed.
