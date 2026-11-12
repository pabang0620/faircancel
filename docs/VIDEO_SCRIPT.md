# Video script (2:46, captions on screen, TTS reads the same sentences)

## Start in the recording state

```bash
npm install
npm run demo:video     # builds, starts the server with a fresh in-memory state, prints the page to open
```

Open `http://localhost:3002/judge?film=1` in a fresh browser window at 1280x720, zoom 125 percent. If the window was used before, press **Start over** first.

Two takes. Pick by what has passed in VERIFY.md on the filming day.

- **Take A, sandbox** (preferred, needs a person): PayPal sandbox keys in `.env`, `LLM_BACKEND=account`, seeds created and approved the night before (`bash scripts/topUpSeeds.sh 10`). Badge "PayPal SANDBOX". Use it only after VERIFY S11 passes. The model answers live.
- **Take B, local** (works today with a fresh copy of `.env.example`): badge "LOCAL MOCK", result cards say "mock". For the sentences below (and the others in the README "Recorded runs" table) the dashboard replays the recorded Claude Sonnet runs and says "Recorded run: Claude Sonnet, 2026-11-12". Scene 9 (PayPal dashboard) is replaced as noted.

Fill the braces with the values on screen: `{refund}` the refund at Cancel now, `{d}` unused days, `{weeks}` the pause length, `{resume}` the resume date, `{refundId}` the refund ID. Never copy numbers from PLAN.md.

Step numbers are the README "Try it" steps; DEVPOST "Testing instructions" uses the same numbers and sentences.

| Time | Scene | On screen | Caption (English) | Criterion |
|---|---|---|---|---|
| 0:00-0:08 | 1 Title | Title card "FairCancel", "A cancel page for PayPal Subscriptions sellers", "Clay Studio is fictional" | Dana sells a $9 weekly pottery class pass on PayPal Subscriptions. | E2 |
| 0:08-0:20 | 2 The rule | Statute text from the README, "contracts entered into, amended, or extended on or after July 1, 2025", "Not legal advice" | California: you may make an offer, but click-to-cancel stays on screen and works at once. | C1, E2 |
| 0:20-0:32 | 3 Step 1 and 2 | `/judge?film=1`, the badge, then button **2 Cancel**; zoom on Cancel now and "If you cancel now: refund {refund}" | Before any offer, you see what cancelling means. | B3, E1 |
| 0:32-0:50 | 4 Step 2 | Type "too expensive", Send: "Nothing to offer". Press Cancel now: CANCELLED, `$9.00 x {d} of 7 days unused = {refund}`, Activity `cancel 204`, `refund 201`, `{refundId}` | Nothing fair to offer, so no offer. One click cancels, and code refunds the unused days. | A1, A3, E1 |
| 0:50-1:18 | 5 Step 3 | Button **1 Pause**, type "Visiting family until mid-January, then I'll be back": "Pause {weeks} weeks instead? (you said mid-January)" beside Cancel now, same size. Dashboard: `Rule: pause 2 weeks` next to the agent chip. Press Pause: SUSPENDED, "Resumes {resume}", `suspend 204` | One offer at most. A pause, never a discount. Cancel now never moves. | D2, C3 |
| 1:18-1:38 | 6 Step 4 | Button **1 Pause** again, type "Back after the holidays, my kid is home": rule card `pause 2 weeks`, agent chip `pause {weeks} weeks (you said ...)`, tool line `get_policy -> get_subscription_state -> propose_offer`. Take B: the chip reads "Recorded run: Claude Sonnet, 2026-11-12" | Keywords can't read "after the holidays". Claude can, and it can only pick from Dana's menu. | A2, D3 |
| 1:38-2:00 | 7 Step 5 | Button **3 Full refund**, type "I was charged yesterday but couldn't make any class this week": tool line `get_policy -> list_recent_payments -> get_usage_record -> quote_refund -> propose_offer`. Cancel now: "full $9.00 goes back", `{refundId}` | It checks the PayPal payment and attendance, then applies Dana's rule. The AI never sets the amount. | A3, B3 |
| 2:00-2:14 | 8 Step 6 | Button **4 Resume a paused one**, Resume now: ACTIVE. Sync on the highlighted row: "Synced: PayPal says ACTIVE" | Paused members come back in one click, and the dashboard re-reads PayPal. | C3, E1 |
| 2:14-2:30 | 9 Proof | Take A: PayPal sandbox dashboard with the cancelled subscription and the refund, next to the Activity row with the same ID. Take B: open "Sandbox evidence" in the dashboard (S3, S5, S9 PASS rows) | Take A: Same IDs in PayPal. Take B: Each PayPal call was checked in the sandbox on Nov 12. | E1, A4 |
| 2:30-2:40 | 10 Tests | `npm test` pass line | Money rules, locks and session isolation are covered by tests. | A3, A4 |
| 2:40-2:46 | 11 End | "FairCancel. Leave in one click." "Built with PayPal Subscriptions, PayPal Agent Toolkit, Claude" | Same text. | E3 |

Do not film: a PayPal buyer login window, the "6 weeks / Dec 24" numbers from PLAN.md, or a "PayPal SANDBOX" badge over a take that did not pass S11.
