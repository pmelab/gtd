# Review: b6103cf

<!-- base: b6103cf5ee4a84e04c97cefc20ec02907d709681 -->

## Detect checkbox-only REVIEW diffs

New pure helper `isCheckboxOnlyDiff` returns true iff a diff has at least one
change and every changed line is a `- [ ]` ↔ `- [x]` flip — header lines
ignored, removed/added counts must match, and each pair must differ only in the
box marker (not be identical). This is the core predicate distinguishing
approval ticks from real feedback.

- [ ] ./src/Events.ts#127
- [ ] ./src/Events.test.ts#116

## Wire reviewCheckboxOnly into gathered payload

`gatherEvents` now computes `reviewCheckboxOnly`: true only when the working
tree is dirty exclusively on `REVIEW.md` and the scoped diff is checkbox-only.
Threaded into the RESOLVE payload alongside `reviewDirty`.

- [ ] ./src/Events.ts#279
- [ ] ./src/Events.ts#338
- [ ] ./src/Events.test.ts#394

## Add scoped diffPath git op

New `diffPath(path)` git operation runs `git diff HEAD -- <path>` so the edge
can inspect only REVIEW.md's working-tree changes, isolated from unrelated
paths.

- [ ] ./src/Git.ts#10
- [ ] ./src/Git.ts#99
- [ ] ./src/Git.test.ts#48

## Route checkbox-only edits to Done

`ResolvePayload` gains `reviewCheckboxOnly`. The machine's review-lifecycle
resolve now short-circuits: committed REVIEW + dirty + checkbox-only → `done`
(auto, `done` edge action), evaluated before the generic
`reviewDirty → accept-review` branch so a pure tick approves instead of seeding
a new cycle.

- [ ] ./src/Machine.ts#114
- [ ] ./src/Machine.ts#271
- [ ] ./src/Machine.ts#456
- [ ] ./src/Machine.test.ts#382

## Update Clean / Await prompts

`clean.md` reframes checkboxes from navigational aids to an approval signal;
`await-review.md` tells the user that checking off boxes (with no other edits)
approves and finishes the review, while non-checkbox edits request changes.

- [ ] ./src/prompts/clean.md#44
- [ ] ./src/prompts/await-review.md#10

## Document checkbox-approval semantics

README and STATES.md updated to describe the new routing: Done now wins on
committed + clean OR committed + checkbox-only flips; Accept Review only on
committed + non-checkbox edits. State table, decision-tree list, flowchart
edges, and the human walkthrough all adjusted.

- [ ] ./README.md#62
- [ ] ./README.md#131
- [ ] ./README.md#159
- [ ] ./README.md#224
- [ ] ./README.md#340
- [ ] ./STATES.md#313
- [ ] ./STATES.md#333

## Add integration scenarios

Two cucumber scenarios in review.feature: checking off all checkboxes approves
(→ `gtd: done`, REVIEW.md gone, no Grilling), and a textual annotation requests
changes (→ `gtd: grilling`, TODO.md seeded).

- [ ] ./tests/integration/features/review.feature#82
