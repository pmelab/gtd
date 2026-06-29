# Review

## Finalize the 16-state design

Replaces the old phase model with the finalized 16-state machine: a single
first-match-wins precedence ladder over steering-file presence + working-tree
status + last-commit subject, an explicit illegal-combination set, and a
"corruption hard-errors rather than guess" rule. This is the spec every other
chunk implements, so read it first — the resolver, edge, and tests are all
direct transcriptions of it. `STATES.html` is the reviewable visual of the same
graph.

- ./STATES.md#56
- ./STATES.md#85
- ./STATES.md#99
- ./STATES.html#1

## Add the pure 16-state resolver

`resolve()` is the new canonical contract: a pure, IO-free fold of the event
stream that ports STATES.md § Precedence verbatim as a first-match-wins ladder
returning a state + `autoAdvance` + optional `EdgeAction`. Scrutinize the
ordering of the ladder (Transport → ERRORS → FEEDBACK → .gtd → REVIEW → New
Feature → TODO → Clean/Idle) and the two hard-error guards — `assertLegal`
(illegal steering-file combos, thrown _before_ the ladder) and `corrupt()` (no
rule matched). The whole decision tree is now trivially unit-testable because it
touches no git/fs/Effect/xstate.

- ./src/Machine.ts#156
- ./src/Machine.ts#293
- ./src/Machine.ts#314
- ./src/Machine.ts#325

## Fold the two fix counters

`testFixCount` and `reviewFixCount` are derived _inside_ the machine by folding
flags off the `COMMIT[]` stream, not recomputed at the edge — mirroring the
verify-counter fold. The load-bearing detail is the reset boundaries:
`testFixCount` resets on any of {package-start, `gtd: feedback`, ERRORS.md
removal} so each test-fix sub-loop, each review-fix, and a human resume each get
a fresh budget; `reviewFixCount` resets only on package-start. Testing reads
these to choose FEEDBACK-vs-ERRORS, and a pending ERRORS deletion forces a
0/false budget because its `gtd: building` commit (which resets the fold) is not
yet in history.

- ./src/Machine.ts#230
- ./src/Machine.ts#384

## Gather the edge event stream

`gatherEvents` is the only place that reads git/fs: it maps every first-parent
commit to a `COMMIT` event under the flat `gtd: <phase>` taxonomy (plus the
`removedErrors` name-status flag) and probes the working tree into one terminal
`RESOLVE` payload. Check the discriminations the ladder depends on:
committed-vs-uncommitted and whitespace-only FEEDBACK.md, REVIEW.md
committed+clean vs committed+dirty, the pending ERRORS deletion probe, and the
review-base computation (merge-base on a branch; last REVIEW.md deletion else
empty-tree on the default branch), set only when its diff is non-empty so Clean
can be told apart from Idle.

- ./src/Events.ts#32
- ./src/Events.ts#145
- ./src/Events.ts#194
- ./src/Events.ts#217

## Perform edge actions and seeds

`perform` executes the chosen `EdgeAction` against the Git/fs primitives; the
driver re-gathers afterward. The site to scrutinize is the two seed mechanics,
which look alike but must differ: New Feature captures `gtd: new task` then
**reverts** it (durable, regenerable after a checkout/pull), whereas Accept
Review **checkouts** away the human's edits (discards them back to the reviewed
baseline) and removes REVIEW.md to stop re-firing. Both seed TODO.md from a
fenced diff so any marker inside it is stripped and does not trip the
open-question gate.

- ./src/Events.ts#106
- ./src/Events.ts#292
- ./src/Events.ts#310

## Fix two cutover runtime bugs

Two correctness fixes found during the cutover. (1) Fixing now deletes
FEEDBACK.md via a `removeFeedback` flag so its removal lands in the same
`gtd: fixing`/`gtd: feedback` commit — without it the next gather re-detects
FEEDBACK (precedence 2) and Fixing loops forever instead of returning to
Testing. (2) A no-op fixer whose green re-test committed nothing leaves HEAD on
`gtd: fixing` and would re-detect Testing forever, so the green path now commits
an empty `gtd: building` to advance HEAD. Verify the empty-FEEDBACK split (empty
→ Close package; non-empty → Fixing+removeFeedback) reads correctly together.

- ./src/Machine.ts#349
- ./src/Events.ts#340
- ./src/Events.ts#356

## Render the prompt set

`buildPrompt` assembles header + context + the state's section, resolving
`{{MODEL}}` per tier and inlining what each state needs; it throws for the six
edge-only states that must never reach it. The flat prompt files replace the old
spec-\* set: grilling carries both tails in one file split on
`<!-- gtd:iterate -->` / `<!-- gtd:stop -->` so the STOP variant spawns no
agent, and fixing inlines the FEEDBACK text (the edge already committed its
removal, so it can no longer be read from disk).

- ./src/Prompt.ts#66
- ./src/Prompt.ts#100
- ./src/Prompt.ts#163
- ./src/prompts/grilling.md#22

## Drive the auto-advance loop

The xstate actor is gone; the driver is a plain gather→resolve→perform loop.
Each turn `detect()` folds the facts through `resolve()`, performs any
`edgeAction`, and either auto-advances (edge-only states) or emits the single
prompt and stops. `detect` wraps `resolve` in `Effect.try` so the
illegal-combo/corruption throws surface on the failure channel as
`gtd: <message>` exit 1; `MAX_EDGE_HOPS` is the defensive bound that turns a
non-progressing machine into a loud failure instead of a spin.

- ./src/main.ts#19
- ./src/main.ts#62
- ./src/State.ts#31
- ./src/State.ts#60

## Add primitives, drop xstate

Additive Git primitives back the new edge actions: `commitHistory` carries the
`removedErrors` name-status flag the counter fold needs, `commitAllWithPrefix`
uses `--allow-empty` (the machine emits fixed-prefix commits even on a clean
tree), plus `lastDeletionOf`, `revertNoCommit`, `mixedResetHead`, `checkoutAll`,
and `removePackageDir`. Config gains the three caps the resolver reads
(`fixAttemptCap`, `reviewThreshold`, `agenticReview` kill-switch), and `xstate`
is removed from `package.json` now that the machine is pure.

- ./src/Git.ts#159
- ./src/Git.ts#218
- ./src/Config.ts#66
- ./package.json#56

## Rewrite the unit tests

The unit suite is reorganized rule-by-rule against the resolver: a `describe`
per precedence rule, plus dedicated blocks for both counter folds and for the
two hard-error throw sites (illegal-combination and corruption). Events tests
cover the flat-taxonomy COMMIT mapping, the RESOLVE payload probes, the review
base, and `perform` execution; a new `State.test.ts` pins the edge-only set.
These are the fastest place to confirm the ladder/guard behavior the design
demands.

- ./src/Machine.test.ts#62
- ./src/Machine.test.ts#129
- ./src/Events.test.ts#163
- ./src/Events.test.ts#390
- ./src/State.test.ts#1

## Rewrite the cucumber suite

The whole spec-\* feature set is deleted and replaced with state-named features
that exercise the live loop end-to-end (transport, new-feature, grilling,
build-lifecycle, testing, fixing, agentic-review, close-package), plus two that
guard the design's edges: `illegal-combinations` (hard-error set) and `replay`
(re-running a committed point is idempotent). Steps were refactored into small
composable Given/When/Then over a `gtd-state` helper so setup is one-commit-per-
step and visible in scenario text.

- ./tests/integration/features/testing.feature#1
- ./tests/integration/features/illegal-combinations.feature#1
- ./tests/integration/features/replay.feature#1
- ./tests/integration/support/steps/gtd-state.steps.ts#20

## Rewrite the docs

README/SKILL/example are rewritten to describe the 16-state machine rather than
the old phases: the precedence ladder, illegal combinations, the 16 states, and
the two fix loops + counter folds, plus a worked feature walk-through. Useful as
a prose cross-check that the documented contract matches the resolver — verify
the precedence and counter-fold sections agree with `Machine.ts`.

- ./README.md#115
- ./README.md#242
- ./SKILL.md#55
- ./example.md#1
