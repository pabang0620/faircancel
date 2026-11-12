# Video script (under 3 minutes, captions only or the same sentences as TTS)

Fill the braces with the values on screen at filming time: `{N}` seeds ready, `{refund}` the refund shown at Cancel now, `{d}` unused days, `{weeks}` the model's pause length, `{resume}` the resume date, `{refundId}` the PayPal refund ID. Never copy numbers from PLAN.md (its "6 weeks / Dec 24" is an old example).

Setup: 1280x720 or larger, browser zoom 125 percent, sandbox keys, `LLM_BACKEND=account` or an API key, `/judge?film=1`, seeds created and approved the night before. Film only the sandbox screen: no "mock" cards, no PayPal buyer login window.

| Time | Screen | Caption (English) |
|---|---|---|
| 0:00-0:10 | Title card "FairCancel", line "A cancel page for PayPal Subscriptions sellers", "Clay Studio is fictional" | Dana sells a $9 weekly pottery class pass on PayPal Subscriptions. |
| 0:10-0:22 | Statute text from the README, "for contracts entered, amended or extended from July 1, 2025", "Not legal advice" | California: you may make an offer, but click-to-cancel stays on screen and works at once. |
| 0:22-0:35 | `/judge?film=1`: SANDBOX badge, "{N} sandbox subscriptions ready", click button 2, zoom on Cancel now and "If you cancel now: refund {refund}" | Before any offer, you see what cancelling means. |
| 0:35-0:55 | Type "too expensive": no offer. Press Cancel now: CANCELLED, formula `$9.00 x {d} of 7 days unused = {refund}`, Activity `cancel 204`, `refund 201`, copy `{refundId}` | Nothing fair to offer, so no offer. One click: cancelled on PayPal, unused days refunded by code. |
| 0:55-1:25 | Button 1, type "Visiting family until mid-January": card "Pause {weeks} weeks instead? (you said mid-January)" beside Cancel now (same size, two guide lines), dashboard `Rule: pause 2 weeks` vs `Agent: pause {weeks} weeks`, press Pause: SUSPENDED, "Resumes {resume}", `suspend 204` | One offer at most. A pause, never a discount. Cancel now never moves. |
| 1:25-1:45 | New Pause (button 1), type "Back after the holidays, my kid is home": rule card pause 2 weeks, Agent (Claude Sonnet) `pause {weeks} weeks (you said "Back after the holidays")`, the tool line in "How FairCancel decided" | Keywords can't read "after the holidays". The model can, and it can only pick from Dana's menu. |
| 1:45-2:10 | Button 3, type "Charged yesterday, couldn't make any class": tool path `get_policy -> list_recent_payments -> get_usage_record -> quote_refund -> propose_offer`, Cancel now, "full $9.00 goes back", `{refundId}` | It checks the PayPal payment and attendance, then applies Dana's rule. The AI never sets the amount. |
| 2:10-2:25 | Button 4, Resume now: ACTIVE, Sync on the highlighted row: "Synced: PayPal says ACTIVE, next billing {date}" | Paused members come back in one click, and the dashboard re-reads PayPal. |
| 2:25-2:40 | PayPal sandbox dashboard: the cancelled subscription and the refund transaction, next to the Activity row with the same ID | Same IDs in PayPal. Subscriptions created and approved in the sandbox the night before. |
| 2:40-2:50 | `npm test` pass line, then the VERIFY table PASS column scrolling for one second | Sandbox checks on Nov 12: refund path, suspended cancel, no double refund. |
| 2:50-2:55 | End card "FairCancel. Leave in one click." "Built with PayPal Subscriptions, PayPal Agent Toolkit, Claude" | Same text. |

Use the 1:25-1:45 scene only after VERIFY C1 and S11 are done on the filming setup. If it is dropped, give its 20 seconds to the 0:55-1:25 scene and the 2:25 scene.
