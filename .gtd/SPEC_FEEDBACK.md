# Spec feedback — 03 the client opens on the step

Everything else in the package checks out: `apply` is mandatory on
`SteeringFormat` with radio/one-edit-set/any-depth behavior and tests for each,
`writeValue`/`setValue` mirror `writeNote` with no new `WriteRefusalReason`
values, `Fleet` is gone from `src/`, `tests/`, and `.storybook/`, both screens
render a terminal handed-back panel, and `npm test` is green across all ten
turbo tasks.

## 1. A refused question write silently shows as saved — the answer vanishes

`src/web/screens/Question.tsx:224` and `:231` both do
`onCommitAnswer?.(anchor, opts)?.catch(() => {})`: the rejection is swallowed
and the optimistic radio/free-text state is left standing. `Plan.tsx:387` seeds
each question from `defaultAnswerFor(node)` only when `answers[index]` is
absent, and never re-derives it from the refetched view, so the false "answered"
state survives the `readSteeringFile` invalidation and every later render for
the rest of the session.

Concretely: the human picks Option A, `setValue` refuses `stale-token` (the
agent's own commit moved `headSha` between render and tap), the radio stays
filled, and nothing is on disk. That is exactly the failure the requirement
names — "the human's answers vanish".

The comment at `:216-219` claims parity with `Review.tsx#useReviewState`'s
optimistic ticks, but that screen does the opposite: `Review.tsx:139-146` and
`:167-171` both revert `ticked`/`notes` on rejection. Same package, same write
path, two contradictory policies, and the comment asserting the wrong one.

Pick one and make the comment true. Reverting matches `Review.tsx` and the
requirement; if the answers must stay optimistic instead, the divergence needs a
stated reason and `Review.tsx`'s reverts need to go with it.

## 2. A test names a behavior it never exercises

`src/ui/Write.test.ts:287` — "commits checked and text together in one call" —
builds `{ ...baseValueRequest(), checked: true }`. `baseValueRequest()` already
sets `checked: true` and no `text` field is ever added, so the case is a
byte-identical duplicate of the test above it and no `checked`+`text` request
ever reaches `writeValue`. The combined path is covered at the format layer
(`OpenQuestions.test.ts:1768`) and the router layer (`Router.test.ts:167`), so
the gap is the lying test name, not the behavior: pass a `text` through
`writeValue` and assert the label change landed in the written bytes, or delete
the test.
