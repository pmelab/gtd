# Review: 07e052e

<!-- base: 07e052e9fa25fb2435c64bd7ecc506e7915c26be -->

## Extract pure formatString

`formatFile` is split so a new `FileSystem`-free `formatString(content)` runs
prettier with the shared `PRETTIER_CONFIG`; `formatFile` now reads then
delegates while preserving its not-found warning, skip-on-error, and
write-only-when-changed behavior. Used by the markerless feedback classifier to
normalize REVIEW.md in memory.

- [ ] ./src/Format.ts#8
- [ ] ./src/Format.ts#25
- [ ] ./src/Format.test.ts#1

## Compute markerless review signals at the edge

`gatherEvents` drops `bangPresent` and the `reviewApprovedNoChanges`
forward-tick machinery, replacing them with two signals:
`reviewHasUncheckedBoxes` (working tree has a `- [ ]` line) and
`reviewHasRealFeedback` (normalize-and-compare via `formatString`, OR any dirty
source / untracked path). Two small pure helpers are extracted and unit-tested
against a temp repo.

- [ ] ./src/Events.ts#1
- [ ] ./src/Events.ts#171
- [ ] ./src/Events.ts#276
- [ ] ./src/Events.test.ts#1

## Route on signals + add review-incomplete leaf

`ResolvePayload` swaps the old fields for the two new signals; a terminal,
non-auto-advance `review-incomplete` leaf is added. Guards:
`reviewApprovedClose` → `closeReview` (all boxes ticked + no real feedback),
plus a new `reviewIncomplete` guard. The review branch is ordered
`await-review → review-incomplete → close-review → review-process` so the
unchecked-boxes gate always wins first.

- [ ] ./src/Machine.ts#30
- [ ] ./src/Machine.ts#52
- [ ] ./src/Machine.ts#114
- [ ] ./src/Machine.test.ts#1

## Wire review-incomplete prompt

A new human-gate prompt `review-incomplete.md` (review everything, tick all
boxes, STOP) is registered in the `SECTIONS` map so `buildPrompt` can render the
new leaf.

- [ ] ./src/prompts/review-incomplete.md#1
- [ ] ./src/Prompt.ts#12

## Remove dead bang plumbing

The now-unused `hasBangAdded` GitService op and its doc comment are deleted (its
only caller went away with the new signals), its test block removed, and the
`!!` clause stripped from the await-review human-gate prompt.

- [ ] ./src/Git.ts#289
- [ ] ./src/Git.test.ts#1
- [ ] ./src/prompts/await-review.md#8

## Add recordAndRevertReview edge op

New write-side GitService op: within one execution it commits the verbatim tree
(`docs(review): record raw feedback for <base>`), captures the diff, reverts,
removes REVIEW.md, and closes (`chore(gtd): close approved review for <short>`).
On a revert conflict it runs `git revert --abort` and fails. Covered by
happy-path and conflict-path tests.

- [ ] ./src/Git.ts#19
- [ ] ./src/Git.ts#183
- [ ] ./src/Git.test.ts#1

## review-process PromptOverride + buildPrompt branch

`PromptOverride` becomes a two-member union (`fix-tests` | `review-process`) in
both `Prompt.ts` and `State.ts`. `buildPrompt` gains a `review-process` branch
that renders the leaf section + the injected feedback diff (fenced) +
auto-advance, surfacing the record-sha for recovery — distinct from the
fix-tests collapse.

- [ ] ./src/Prompt.ts#54
- [ ] ./src/Prompt.ts#99
- [ ] ./src/Prompt.ts#149
- [ ] ./src/State.ts#13
- [ ] ./src/Prompt.test.ts#1

## Wire edge phase in main.ts

A `review-process` pre-render phase (parallel to `TEST_GATED_LEAVES`) runs
`recordAndRevertReview(baseRef)` and emits the override-injected prompt; revert
conflicts surface as exit 1 via the existing `catchAll`. `review-process` stays
out of the test gate.

- [ ] ./src/main.ts#26

## Slim review-process prompt

`review-process.md` is reduced to synthesis-only: read the injected diff (global
/ local / suggestion taxonomy), write `TODO.md`, format, commit only `TODO.md`.
All git machinery, the FAILURE BRANCH, and every `!!` mention are gone — the
edge now does that work.

- [ ] ./src/prompts/review-process.md#1
- [ ] ./src/prompts/review-process.md#32

## Markerless review e2e features

`spec-harvest.feature` is replaced by `spec-feedback.feature` asserting the
markerless rule (`// !!` is ordinary feedback). `review.feature`,
`spec-review-conclude.feature`, and `spec-verbatim-first.feature` are updated
for the four-outcome routing and the slimmed prompt, adding `review-incomplete`
STOP scenarios.

- [ ] ./tests/integration/features/spec-feedback.feature#1
- [ ] ./tests/integration/features/review.feature#1
- [ ] ./tests/integration/features/spec-review-conclude.feature#1
- [ ] ./tests/integration/features/spec-verbatim-first.feature#1

## Update README for new model

State table, prose, and mermaid diagram drop every `!!` reference, add the
`review-incomplete` leaf, retable `close-review`/`review-process`, and describe
the edge-driven record → capture → revert → close flow with the "any change is
feedback" taxonomy.

- [ ] ./README.md#53
- [ ] ./README.md#107
- [ ] ./README.md#203
