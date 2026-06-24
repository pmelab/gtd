# Review: a16bbc4

<!-- base: a16bbc42b423952f525d03712dea4c87e6e23b48 -->

## Mechanical revert-based teardown (prompt)

`review-process.md` Steps 6–8 are rewritten to your proposed flow: commit the
whole dirty tree verbatim as reference commit "x", synthesize `TODO.md` from
`git show <x>`, then `git revert --no-edit <x>`, `git rm REVIEW.md`, and end
with a `chore(gtd): close approved review for <short-sha>` anchor commit. On a
revert conflict it aborts (`git revert --abort`) and escalates — no
half-reverted tree. The old `git checkout -- .` / `git clean -fd` reset is gone.
Net: no reviewer artifacts (`!!` or illustrative edits) linger in code.

- [ ] ./src/prompts/review-process.md#11
- [ ] ./src/prompts/review-process.md#36

## reviewPresent gate: no code-changes during review (Q2)

`ResolvePayload` gains `reviewPresent` (set from `reviewExists` in Events.ts),
and the `codeDirty` guard becomes `params.codeDirty && !params.reviewPresent`.
So while a `REVIEW.md` exists, `code-changes` is suppressed and the reviewer's
edits reach `review-process` **uncommitted** (captured whole into commit "x").
Guard order is unchanged — only the one guard is gated. An in-progress review
with no feedback yet holds at `await-review`.

- [ ] ./src/Machine.ts#119
- [ ] ./src/Machine.ts#54
- [ ] ./src/Events.ts#334

## hasBangAdded: harvest reduced to a boolean (Q1)

`grepBangAdded` (per-comment `BangComment[]`) is reduced to
`hasBangAdded(ref): boolean` — the agent now reads the whole commit-"x" diff, so
per-`!!` extraction is redundant. `bangPresent` survives as the only signal that
diverts a forward-tick-only approval into `review-process`. `BangComment` and
the `Prompt.ts` injection block are deleted; the dead `checkoutTracked`/
`cleanUntracked` git ops are removed (Q3).

- [ ] ./src/Git.ts#206
- [ ] ./src/Git.ts#19
- [ ] ./src/Events.ts#261
- [ ] ./src/Prompt.ts#85

## Tests + docs

Machine unit tests pin the Q2 routing (note+dirty→review-process,
unmodified+dirty→await-review, codeDirty+!reviewPresent→code-changes). The e2e
features assert routing + the revert teardown (`git revert --no-edit`, close
anchor) instead of harvested `!!` text; `spec-verbatim-first` scenario 3 updated
for the gate. README table/mermaid/walkthrough describe the gate + teardown.

- [ ] ./src/Machine.test.ts#35
- [ ] ./tests/integration/features/review.feature#225
- [ ] ./tests/integration/features/spec-harvest.feature#1
- [ ] ./README.md#57
