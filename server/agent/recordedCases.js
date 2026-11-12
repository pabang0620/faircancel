// Sentences recorded once each through the local Claude Code account (scripts/recordRuns.js).
// `step` is the README "Try it" step that uses the sentence; null marks an extra sentence a judge may type.
// The extras are varied on purpose: some carry a return time code can read ("six weeks"), most do not.
export const RECORDED_CASES = [
  { id: 'step2_too_expensive', step: 2, scenario: 2, reason: 'too expensive' },
  { id: 'step3_hero_a', step: 3, scenario: 1, reason: "Visiting family until mid-January, then I'll be back" },
  { id: 'step4_hero_b', step: 4, scenario: 1, reason: 'Back after the holidays, my kid is home' },
  { id: 'step5_billing', step: 5, scenario: 3, reason: "I was charged yesterday but couldn't make any class this week" },
  { id: 'extra_school_starts', step: null, scenario: 1, reason: 'When school starts again I will come back' },
  { id: 'extra_wrist_surgery', step: null, scenario: 1, reason: 'Recovering from wrist surgery, the doctor said about six weeks' },
  { id: 'extra_work_travel', step: null, scenario: 1, reason: 'Travelling for work for the rest of the year' },
  { id: 'extra_baby_due', step: null, scenario: 1, reason: "Our baby is due next month, I'll come back once things settle down" },
  { id: 'extra_spring_term', step: null, scenario: 1, reason: 'Need a break until the spring term' },
  { id: 'extra_paycheck', step: null, scenario: 1, reason: 'Money is tight until my next paycheck in two weeks' },
  { id: 'extra_out_of_country', step: null, scenario: 1, reason: 'Out of the country until Feb 3' },
  { id: 'extra_moving', step: null, scenario: 2, reason: 'Moving across the country, no studio near my new place' },
  { id: 'extra_no_time', step: null, scenario: 2, reason: 'Honestly I just never find the time to go' },
  { id: 'extra_charged_again', step: null, scenario: 3, reason: 'Why was I charged again? I thought I cancelled last week' },
]
