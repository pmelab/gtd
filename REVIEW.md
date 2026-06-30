# Review

## Replace xstate machine with pure resolver

The heart of the branch: `src/Machine.ts` drops xstate entirely (no `setup`,
`createActor`, actor handle, or `TEST_RESULT`/`REVIEW_RECORDED` feedback
events). In its place is a single pure `resolve(events)` function that folds the
`COMMIT[]` stream into two counters (`foldCounters`) and then runs the STATES.md
precedence ladder as a first-match-wins chain over the terminal `RESOLVE`
payload. The 18 internal leaf states collapse to a flat `GtdState` union of 16,
the old per-intent `PendingCommitIntent`/`EdgeAction` zoo shrinks to 8 simple
edge actions, and illegal/unrecognized inputs now throw a typed `GtdStateError`
(`illegal-combination` vs `corruption`) instead of guessing. The counter folds
(`testFixCount`/`reviewFixCount`) live inside the machine, keeping the edge
thin.

- ./src/Machine.ts#1
- ./src/Machine.ts#37
- ./src/Machine.ts#110
- ./src/Machine.ts#261
- ./src/Machine.ts#399
- ./src/Machine.ts#418
- ./src/Machine.ts#659
- ./src/Machine.ts#711
- ./src/Machine.ts#760
- ./src/Machine.ts#783
- ./src/Machine.ts#829

## Rework the edge: snapshot probing and a perform dispatcher

`src/Events.ts` is rebuilt around the new contract. `gatherEvents` derives the
slimmer `ResolvePayload` (presence/dirtiness flags only, no counts — the machine
counts) and emits flat `gtd: <phase>` `CommitEvent`s carrying `removedErrors`.
The frontier-walking review-base heuristic, plan-phase parsing, REVIEW.md
checkbox/feedback analysis, and trailing-counter helpers are all deleted; the
review base is now a simple merge-base / last-REVIEW-deletion / empty-tree pick.
A new `perform(action)` dispatcher executes each of the 8 edge actions
(transportReset, seedNewFeature, seedAcceptReview, runTest, commitPending,
closePackage, commitReview, done), and `seedTodo` builds the deterministic
New-Feature / Accept-Review seed.

- ./src/Events.ts#1
- ./src/Events.ts#27
- ./src/Events.ts#90
- ./src/Events.ts#141
- ./src/Events.ts#159
- ./src/Events.ts#552
- ./src/Events.ts#609

## Slim Git primitives to single-purpose commands

`src/Git.ts` swaps the high-level bookkeeping operations (recordAndRevertReview,
closeReview, approveSpecReview, commitPending with restore/derive logic,
diffRefExcludingGtd, ancestor/count helpers) and the `deriveCommitMessage` /
`CommitMessageInputs` derivation for a handful of thin git wrappers:
`revertNoCommit`, `mixedResetHead`, `checkoutAll`, `lastDeletionOf`,
`commitHistory` (first-parent, flags ERRORS.md deletions), `removePackageDir`,
and `commitAllWithPrefix`. Commit-message derivation moves out of Git since
subjects are now fixed `gtd: <phase>` strings.

- ./src/Git.ts#1
- ./src/Git.ts#32
- ./src/Git.ts#49

## Retune config keys to the new state vocabulary

`src/Config.ts` renames the model-state keys (`new-todo`/`modified-todo`/
`execute`/`spec-review`/`spec-fix` → `grilling`/`building`/`fixing`/
`agentic-review`/`clean`), remaps their tiers, and replaces the
`agenticReviewMaxCycles` knob with two caps the machine reads: `fixAttemptCap`
and `reviewThreshold` (both default 3). `agenticReview` stays as the gate
kill-switch.

- ./src/Config.ts#1
- ./src/Config.ts#40

## Simplify State.detect and the driver loop

`src/State.ts` drops the long-lived `Handle`/`start`/`advance` surface:
detection is now `gatherEvents()` folded through pure `resolve()` inside
`Effect.try` (so `GtdStateError` surfaces in the failure channel). It also
defines the `EDGE_ONLY_STATES` set / `isEdgeOnly` used to decide auto-advance.
`src/main.ts` replaces the recursive `Effect.suspend` action switch with a flat
gather→resolve→perform while-loop bounded by `MAX_EDGE_HOPS`, continuing past
edge-only states and stopping to print the prompt on the first prompt-bearing
state.

- ./src/State.ts#1
- ./src/State.ts#229
- ./src/State.ts#262
- ./src/main.ts#1
- ./src/main.ts#325
- ./src/main.ts#450

## Rebuild prompt rendering for 16 states

`src/Prompt.ts` re-imports the renamed prompt files, defines the `PromptState`
type and `EDGE_ONLY_STATES` guard (rendering an edge-only state throws), maps
each prompt-bearing state to its `ModelState` for `{{MODEL}}` resolution, and
adds the special grilling split (one file delimited by `<!-- gtd:iterate -->` /
`<!-- gtd:stop -->` so the STOP variant spawns no agent).

- ./src/Prompt.ts#1
- ./src/Prompt.ts#64

## Swap the prompt file set

The prompt corpus is renamed to match the states: old phase prompts (`new-todo`,
`modified-todo`, `execute`, `human-review`, `spec-review`, `spec-fix`,
`fix-tests`, `review-process`, `review-incomplete`, `await-answers`, `verified`)
are removed and replaced by `grilling`, `building`, `fixing`, `agentic-review`,
`clean`, `idle` (plus retuned `decompose`, `escalate`, `await-review`).

- ./src/prompts/grilling.md#1
- ./src/prompts/building.md#1
- ./src/prompts/fixing.md#1
- ./src/prompts/agentic-review.md#1
- ./src/prompts/clean.md#1
- ./src/prompts/idle.md#1
- ./src/prompts/execute.md#1
- ./src/prompts/spec-review.md#1
- ./src/prompts/review-process.md#1

## Rewrite documentation for the 16-state machine

The docs are brought in line with the redesign: `STATES.md` is rewritten as the
canonical state/precedence spec, a new `STATES.html` rendering is added,
`README.md` and `SKILL.md` are rewritten around the flat taxonomy and pure
resolver, and `example.md` is updated to the new walkthrough.

- ./STATES.md#1
- ./STATES.html#1
- ./README.md#1
- ./SKILL.md#1
- ./example.md#1

## Replace the integration test suite

The feature suite is re-cut to the new vocabulary. Spec-\* / intent / frontier /
verify-loop / gate features tied to the old taxonomy are deleted and replaced
with feature files named after the new states and lifecycles (build-lifecycle,
close-package, fixing, grilling, testing, new-feature, transport,
illegal-combinations, verify-loop, etc.). The shared steps are reworked:
`common.steps.ts` is updated, a new `gtd-state.steps.ts` adds generic state
assertions, and the now-obsolete `review.steps.ts` / `spec-review.steps.ts` are
removed.

- ./tests/integration/features/build-lifecycle.feature#1
- ./tests/integration/features/close-package.feature#1
- ./tests/integration/features/fixing.feature#1
- ./tests/integration/features/grilling.feature#1
- ./tests/integration/features/testing.feature#1
- ./tests/integration/features/illegal-combinations.feature#1
- ./tests/integration/features/transport.feature#1
- ./tests/integration/support/steps/common.steps.ts#47
- ./tests/integration/support/steps/gtd-state.steps.ts#1
- ./tests/integration/support/steps/review.steps.ts#1
