# FairCancel

FairCancel is the subscriber-facing cancel page. It does not change prices or plans (see Reprice Desk for that).

**Pitch.** FairCancel gives merchants who bill with PayPal Subscriptions a cancel page designed to follow California's click-to-cancel rule: at most one offer, and it is a pause, never a discount; a "Cancel now" button that never leaves the screen; and an immediate PayPal suspend or cancel, with the unused days refunded by code, not by the AI.

Not legal advice. Designed to follow Cal. Bus. & Prof. Code section 17602(e)(2) for contracts entered, amended or extended from July 1, 2025. MIT licensed.

## What it is

A small seller (the fictional "Clay Studio", a $9 per week online pottery class pass) bills with PayPal Subscriptions. When a subscriber presses Cancel:

1. "Cancel now" and the line "If you cancel now: refund $X (Clay Studio's policy, set ...)" are on screen before anything else, and stay in the same place in every state.
2. The subscriber may type a reason. An agent reads it and picks **at most one** offer: a pause whose length comes from the merchant's menu (2, 4, 6 or 8 weeks), or no offer. There is no discount, coupon or price change anywhere in the code.
3. With sandbox keys, a pause is a real `suspend` on the PayPal subscription; FairCancel's scheduler calls `activate` on the resume date. "Cancel now" is a real `cancel`, and the unused days are refunded through PayPal. Each of these calls was checked against the sandbox on 2026-11-12 (VERIFY S3, S4, S5, S8), and the whole Judge page was walked on sandbox subscriptions the same day (S11): the refund IDs it showed, for example 5N302748GW6167052, read back COMPLETED from the PayPal API. In local mode the same screens run against a local stand-in and every result card says "mock" and the local IDs are `MOCK-...`, not PayPal-shaped.

The refund is computed by the server from the subscription's PayPal transactions (last COMPLETED payment plus the 7 day period). Zero classes attended this week means a full refund; otherwise the unused fraction, rounded down to the cent: $9.00 x 6/7 = $7.71. The model never sets an amount and any dollar figure in model text that is not the server's figure is thrown away.

Churnkey's rebates are Stripe only (https://docs.churnkey.co/cancel-flows/offers/rebate). FairCancel lets a PayPal Subscriptions merchant keep PayPal instead of moving to Stripe.

## Try it (judges)

No PayPal login needed. `cp .env.example .env`, `npm install`, `npm run build`, `npm start`, open `http://localhost:3002/judge`. With no keys set the app runs in **local mode** (banner "local mode, no PayPal calls"); with sandbox keys and a seeded pool it uses real sandbox subscriptions. In local mode no model is called: for the four sentences below the dashboard replays a recorded real Claude Sonnet run and labels it "Recorded run: Claude Sonnet, 2026-11-12" (see "Real model"). Every step finishes in a few seconds; nothing waits on a timer.

1. Open `/judge`. The top shows the pool: "N sandbox subscriptions ready" (or the local mode strip).
2. Button **2 Cancel**: note the refund line under Cancel now. Type "too expensive" and Send: no offer. Press **Cancel now**: CANCELLED, the formula, e.g. `$9.00 x 6.0 of 7 days unused = $7.71` one day after the payment (your numbers depend on when the seed was charged), the refund ID, and the PayPal calls in the Activity list.
3. Button **1 Pause**: type "Visiting family until mid-January, then I'll be back". The dashboard shows `Rule: pause 2 weeks` next to the agent's pick, and the subscriber card says "(you said mid-January)". The agent's pick is the menu value (2, 4, 6 or 8 weeks) closest to the number of weeks between today and January 15, so it depends on the day you try it: about 9 weeks away picks 8, about 6 weeks away picks 6, about 4 weeks away picks 4, and more than 12 weeks away gets no offer. Once January 15 has passed, the same sentence means next year and gets no offer; type "Visiting family, back in about 4 weeks" instead. Press Pause: SUSPENDED, "Resumes ..." (FairCancel calls `activate` on that date). In local mode the agent chip is the recorded run; the server still snaps its value to today's distance to January 15.
4. Button **1 Pause** again (a new subscription), type **"Back after the holidays, my kid is home"**. No keyword code can read a return time here: the rule card says `pause 2 weeks`, while a model (see "Real model") reads the sentence, works out the weeks from today and picks a menu value, e.g. `pause 8 weeks (you said Back after the holidays, my kid is home)` in the recorded run of 2026-11-12. The server only checks that the value is on the menu and that the quoted words really are in the sentence. Any other sentence, in local mode, goes to the rule-based stand-in, which gives the rule value and says so.
5. Button **3 Full refund**: type "I was charged yesterday but couldn't make any class this week". "How FairCancel decided" lists the tool calls; Cancel now refunds the full $9.00.
6. Button **4 Resume a paused one**: press Resume now: ACTIVE. Press **Sync** on the dashboard to re-read the state from PayPal.

Each browser session gets its own subscriptions (up to 6). Other sessions cannot see or touch them. **Start over** (top right) removes your subscriptions so you can run a scenario again; an untouched sandbox subscription goes back to the pool. New sessions and sandbox subscriptions taken are capped per network address per hour so the seed pool cannot be drained.

## Run it

```bash
npm install
npm run build
npm start              # http://localhost:3002/judge
npm test               # node --test, forced to mock mode, no outside calls
```

For filming, `npm run demo:video` builds, starts a fresh server and prints the page to open (`docs/VIDEO_SCRIPT.md` has the scene list and both takes). `/judge?film=1` shows a large PayPal SANDBOX (or LOCAL MOCK) badge next to the scenario buttons, and a click on a refund ID in the Activity list copies it.

Dev: `npm run dev:server` and `npm run dev:client` (Vite proxies `/api` to port 3002).

## Environment variables

| Name | Default | Meaning |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | empty | Sandbox app credentials. Empty means local mode |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | empty, `claude-sonnet-5-5` | Claude for the agent. Empty means the rule-based stand-in makes the same tool calls |
| `LLM_BACKEND` | empty (mock, or the key above) | `account` runs the same prompt and tools through the Claude Agent SDK with your local Claude Code login (development only, the API key is removed from its environment). The dashboard then says "Claude Sonnet (local account)" |
| `LLM_LIVE_UNTIL` | 2026-12-22 | Model is never called after this moment |
| `REFUND_PATH` | `v2capture` | `v2capture` or `v1sale`. Fixed from the S3 check in `VERIFY.md`, never switches at runtime |
| `PORT` | 3002 | Server port |
| `DATA_DIR` | `data` | Policy file and seed pool file |
| `MERCHANT_NAME` | Clay Studio | Fictional merchant name on screen |
| `AGENT_TIMEOUT_MS` | 6000, or 15000 with `LLM_BACKEND=account` | Wait for the agent before showing the rule card only. Cancel now never waits |
| `MAX_SEEDS_PER_SESSION` | 6 | Subscriptions one session can hold |
| `OFFERS_PER_IP_HOUR` | 40 | After this, the free stand-in answers instead of the paid model |
| `NEW_SESSIONS_PER_IP_HOUR` | 10 | New sessions one IP can start per hour |
| `SEEDS_PER_IP_HOUR` | 12 | Sandbox subscriptions one IP can take per hour (Start over does not reset it) |
| `REFUND_MAX_TRIES` | 3 | Refund attempts when PayPal does not answer, then the refund is marked failed for the merchant |
| `REPLAY_RECORDED_RUNS` | 1 | In local mode, replay the recorded Claude Sonnet runs for their exact sentences. 0 sends every sentence to the rule-based stand-in |
| `ALLOW_POLICY_EDIT` | 0 | 1 lets `PUT /api/policy` change the merchant layer |
| `FORCE_MOCK` | 0 | 1 forces local mode |
| `MOCK_V2_REFUND`, `MOCK_SUSPENDED_CANCEL` | 1 | Set 0 to make the local stand-in reject that call, to exercise fallback paths |
| `SANDBOX_BUYER_EMAIL`, `SANDBOX_BUYER_PASSWORD` | empty | Only for `scripts/approveSeeds.py` and `scripts/topUpSeeds.sh` (the shell environment is read first, `.env` second) |

## The statute, and what is stricter on purpose

> "...the business may display a discounted offer, retention benefit, or information regarding the effects of cancellation, provided that the business simultaneously displays a prominently located and continuously and proximately displayed direct link or button entitled "click to cancel," or words to that effect... If the consumer utilizes this direct link or button, the business shall promptly process the cancellation and shall not otherwise obstruct or delay the consumer's ability to proceed to cancellation." (Cal. Bus. & Prof. Code section 17602(e)(2), https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17602. ; same text at https://codes.findlaw.com/ca/business-and-professions-code/bpc-sect-17602/.) Subsection (j): the amendments "shall only apply to a contract entered into, amended, or extended under this article on or after July 1, 2025."

The law allows discounted offers. FairCancel does not make them: one offer at most, a pause only, and a pro-rata refund on cancel are the merchant's and our choices, not legal requirements. Policy is two layers in code: a locked state layer (Cancel now always visible, cancel processed at once; the merchant cannot switch it off) and the merchant layer (pause menu, refund mode, full refund when no class was attended). Whether a recurring renewal counts as "extended" under subsection (j) is an interpretation question we do not settle here.

## PayPal calls

| Step | Call | Via |
|---|---|---|
| Read state | `GET /v1/billing/subscriptions/{id}` | Agent Toolkit `show_subscription_details` |
| Payments for the refund quote | `GET /v1/billing/subscriptions/{id}/transactions` | REST |
| Pause | `POST .../suspend` with `reason` | REST |
| Resume | `POST .../activate` with `reason` | REST |
| Cancel | `POST .../cancel` with `reason` | Agent Toolkit `cancel_subscription` |
| Refund (first choice) | `POST /v2/payments/captures/{transaction id}/refund` | Agent Toolkit `create_refund` |
| Refund (documented fallback) | `POST /v1/payments/sale/{transaction id}/refund` (marked deprecated by PayPal) | REST |
| Seed setup | create product, plan and subscription | Agent Toolkit |

Whether a subscription transaction ID works as a v2 capture ID is checked first (S3 in `VERIFY.md`). The result fixes `REFUND_PATH`; the app never tries the other path on its own, because two paths could refund the same money twice. Every call shows up in the dashboard Activity list with endpoint and status code, and the result card names the refund path actually used. S3 passed on 2026-11-12: subscription transaction IDs work as v2 capture IDs, so `REFUND_PATH=v2capture`.

Refund safety: every refund request carries the same `PayPal-Request-Id` (v1 REST header; for the v2 path a Toolkit instance is built with `context.request_id`). If an attempt ended without an answer, the retry is sent with the same `PayPal-Request-Id`, which PayPal de-duplicates (S9). The capture does not report a refunded total in our sandbox test (V14), so if that is not enough the request ends as 'refund by hand' and no second refund is sent. A refusal from PayPal (4xx) or `REFUND_MAX_TRIES` unanswered tries ends the request: the merchant panel shows "Refund failed, refund by hand" and nothing retries on its own. The Toolkit reports failures inside its JSON result (`{ok:false,status,code,message}` or `{error:{message,type}}`); `server/paypal/errors.js` turns them into transient (network, 5xx, 429) or final errors and recognises the wrong-state message ("Invalid subscription status ...") so a SUSPENDED subscription is activated and then cancelled.

What PayPal does not give us: a resume date on suspend (the scheduler calls activate), and automatic pro-rata refunds on cancel (we found no automatic cancel-time proration in PayPal's Subscriptions docs), so a calculator in code does that.

PayPal's own pause page describes pausing as a way to "reduce customer churn" without a "hard cancellation" (https://developer.paypal.com/subscriptions/pause-or-resume). It documents the API call; the subscriber screen is left to the merchant. (Buyers can still end an automatic payment from their PayPal account.) FairCancel is that screen on the seller's own page.

## What the AI does and does not do

Seven tools, none of which can change a subscription or move money: `get_subscription_state`, `list_recent_payments`, `get_usage_record`, `get_policy`, `quote_refund`, `propose_offer`, `answer_subscriber`. At most 8 calls per decision (5 lookups). It reads a return time out of free text ("until mid-January", "maybe 5 weeks off", and sentences keywords cannot read like "back after the holidays"), snaps it to the merchant menu, and chooses whether a pause fits. The model earns its place on sentences like the last one. The keyword "rule card" can only say "temporary, shortest pause"; both are shown side by side. The server validates every proposal (menu only, pause only, quoted words must be the subscriber's own), and if the subscriber's words contain a date or a count of weeks that code can read, the server's own snap to the menu wins. When code cannot read a return time, the model's menu value stands and is shown as the model's. Cancel now never waits for the agent. If the agent is late (6 seconds, at least 15 with `LLM_BACKEND=account`), the server's own reading of a date in the words is used ("until mid-January" still gives 8 weeks), and the rule card only when the words have no date.

Without a model, local mode first looks for a recorded real run of the exact sentence (below). Otherwise a deterministic stand-in makes the same tool calls; the dashboard then says "Agent (rule-based stand-in)" and explains that no model is answering. The weekly "why people leave" list is plain keyword grouping, not a model.

### Real model

The default run and `npm test` use the stand-in. `LLM_BACKEND=account` (local development, not for hosting) runs the same system prompt and seven tools through your Claude Code login with `claude-sonnet-5-5`, never an API key. It was run on 2026-11-12 (VERIFY C1): tools in the expected order, hero sentences answered by the model, 5.3 to 8.7 s per decision. That does not verify the hosted API path.

Recorded runs: `npm run record:runs` ran the four README sentences once each through that account path and saved each run in `server/agent/recorded-runs/*.json` (tool calls in order with their inputs and arrival times, the model's final text, its proposal, wall time). In local mode the server replays a recording only for its exact sentence: it runs the same tool calls in the same order against your subscription and puts the recorded proposal through the same server checks, so a recorded "8 weeks" is still re-snapped to today. The dashboard labels it "Recorded run: Claude Sonnet, 2026-11-12" and the subscriber card marks the model's sentence as recorded. A recorded sentence is hidden if the server changed the pause length. `REPLAY_RECORDED_RUNS=0` turns replay off.

| Step | Sentence | Tools the model called | Model pick | Time |
|---|---|---|---|---|
| 2 | too expensive | get_policy, get_usage_record, quote_refund, propose_offer | no offer | 7.8 s |
| 3 | Visiting family until mid-January, then I'll be back | get_policy, get_subscription_state, propose_offer | pause 8 weeks | 5.6 s |
| 4 | Back after the holidays, my kid is home | get_policy, get_subscription_state, propose_offer | pause 8 weeks | 6.1 s |
| 5 | I was charged yesterday but couldn't make any class this week | get_policy, list_recent_payments, get_usage_record, quote_refund, propose_offer | no offer | 5.3 s |

## Compared with

- Churnkey: its native billing providers are Stripe, Chargebee, Paddle and Braintree (https://docs.churnkey.co/billing-providers/payment-provider-overview); any other billing system goes through Churnkey Direct, where "you pass customer and subscription data directly and handle billing operations through callbacks" (https://docs.churnkey.co/billing-providers/direct-connect/direct). Its rebates are "Stripe only" (https://docs.churnkey.co/cancel-flows/offers/rebate). It shows a "Cancel Now" option to California and New York customers and recommends "a more aggressive Initial Offer than your default" for them (https://docs.churnkey.co/cancel-flows/click-to-cancel). FairCancel's rule is the opposite: one pause, never a discount, unused days go back.
- Kajabi: "PayPal cancellations finish outside of Kajabi" (https://help.kajabi.com/en/articles/17175923). FairCancel finishes them on the seller's own page through the cancel API.

## Related projects, not overlapping

Reprice Desk changes prices and plans. FairCancel has no `update-pricing-schemes`, `revise`, plan or subscription PATCH, and no discount type. It uses a different fictional merchant and a different sandbox business account.

## Webhooks

`POST /api/webhooks/paypal` accepts `BILLING.SUBSCRIPTION.*` and payment events. The payload is only a hint: the server re-reads the subscription from PayPal (the same code as the Sync button) and never trusts the body. Event names and delivery are listed as S10 in `VERIFY.md`.

## Layout

`server/` Express API, refund calculator, policy, PayPal gateway (live and local), agent. `client/` React 19 with Vite. `test/` node:test. `scripts/` sandbox seeding and checks run by a person.

### Sandbox evidence (VERIFY.md, 2026-11-12)

PASS today: S3 (subscription transaction ID works as a v2 capture ID, refund 201), S5 (a SUSPENDED subscription can be cancelled directly), S9 (same `PayPal-Request-Id`, one refund), S4 (suspend then activate keeps the billing date, API side), S8 (Toolkit cancel), V15 (wrong-state error text), S1, S2, S6 (seeding), V11, V12 (payment time and window), C1 (Claude Sonnet through the local account), S11 (the full Judge-mode walk on sandbox subscriptions: cancel, suspend, activate and two refunds, every ID read back from PayPal). Open: S7, S10. Partial: V13. Failed: V14 (handled, see below). The Judge page shows the same list under "Sandbox evidence" in the merchant dashboard.

### Sandbox findings (2026-11-12)

- Subscription transaction IDs work as v2 capture IDs (S3), so `REFUND_PATH=v2capture`.
- After a refund the capture shows status `PARTIALLY_REFUNDED` but no `seller_payable_breakdown.total_refunded_amount` (V14). A retry of a v2 refund whose answer was lost cannot confirm the earlier one, so the request ends as "refund by hand" and no second refund is sent. The same request id is also de-duplicated by PayPal (S9).
- Seeds: 27 created and approved headless one after another so far, 32-50 s each (S1); the first 5 went to the API checks and 12 to the S11 runs; 9 were untouched after that. The first payment is COMPLETED seconds to a few minutes after approval (S2).

### Sandbox demo mode

The default stays local mode, so a judge without keys needs nothing. For a server that runs the real sandbox flow (the deployed demo):

1. Put the sandbox app's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env` (`node scripts/seedLive.js plan` once creates the $9 weekly plan).
2. Fill the pool: `SANDBOX_BUYER_EMAIL=... SANDBOX_BUYER_PASSWORD=... bash scripts/topUpSeeds.sh 20` (set them in the shell or `.env`, never on a shared command line).
3. `npm run build && npm start`. The start line says `PayPal=sandbox`, the header says "N sandbox subscriptions ready" instead of "local mode, no PayPal calls", `/judge?film=1` shows the PayPal SANDBOX badge, and every result card says "Cancelled on PayPal" with the PayPal refund ID. When the pool is empty the page offers "Continue in local mode".
4. Optional, development only: `LLM_BACKEND=account` makes the dashboard say "Claude Sonnet (local account) is answering". It waits at least 15 s for the model; if the model is slower, the server's own reading of a date ("until mid-January") or the rule card is shown and Cancel now never waits.
5. After a walk, `python3 scripts/walkJudge.py http://localhost:3002 <folder>` then `node scripts/verifyS11.js <folder>/walk_log.json` checks every subscription status and refund ID shown on screen against the PayPal API.

### Seeds

The header count "N sandbox subscriptions ready" only counts seeds that were not claimed and not found cancelled or expired (a startup scan marks those). Top up with `SANDBOX_BUYER_EMAIL=... SANDBOX_BUYER_PASSWORD=... bash scripts/topUpSeeds.sh 60` (create, approve one after another, collect; log under `.scratch/`). Measured 32 to 50 s per seed, so 60 seeds take about 40 minutes. A seed that already had a refund is capped by what is left, and the refund text says so.
