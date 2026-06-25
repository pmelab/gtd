# Fix: new TODO.md after a closed review wrongly triggers a REVIEW.md

## Problem

Reported symptom: after a fresh `TODO.md` is created and gtd commits it (as
`plan(gtd): grilling`), the **next** gtd run generates a `REVIEW.md` whose only
content is "the addition of TODO.md". A brand-new plan must never produce a
review.

## Root cause

The review base is chosen by `computeReviewBase` in `src/Events.ts` (lines
~103-167). Its candidates are:

1. merge-base with the default branch,
2. last `review(gtd): create review for ...` commit (`lastReviewCommit`),
3. last `chore(gtd): close approved review for ...` commit (`lastCloseCommit`).

There is a **frontier-at-HEAD guard** (Events.ts ~119-131): if the last
review/close commit _is_ HEAD, it returns `none` — nothing new to review. This
is the only protection that keeps a just-closed review from re-surfacing.

The guard is too narrow. It only fires when the close commit equals HEAD.
Reproduction in this very repo:

- HEAD = `e623be4 chore(gtd): close approved review for b7f1bab` (a close
  commit, == HEAD → guard fires, all good).
- User creates a new `TODO.md` and runs gtd. gtd commits `plan(gtd): grilling`.
  HEAD is now the **plan commit**, one ahead of the close commit.
- Next run: `lastCloseCommit` still resolves to `e623be4`, which is now a strict
  **ancestor** of HEAD (not equal), so the frontier guard does **not** fire.
  `e623be4` qualifies as the review base.
- `diffRef(e623be4)` = `git diff e623be4 HEAD` = exactly the newly-added
  `TODO.md` → non-empty → `reviewBasePresent = true`.
- In `Machine.ts` the `humanReview` guard
  (`reviewBasePresent && refDiff non-empty`, line ~289) fires → state
  `human-review` → agent writes `REVIEW.md` containing only the TODO.md
  addition.

In short: **once any commit lands on top of the close commit, the review
frontier is "lost" and the close commit becomes a base whose diff is pure
gtd-workflow noise (the plan commit).**

Note: the guard-chain ordering (`todoInitial` before `humanReview`, Machine.ts
~250-251) does _not_ save us here, because after the commit `todoDirty === null`
and `planEverGrilled === true`, so `todoInitial` is false.

## Fix

The diff between the close commit and HEAD consists _entirely_ of gtd-workflow
commits (`plan(gtd):`, `review(gtd):`, `chore(gtd):`). These carry no reviewable
code, so they must not make `reviewBasePresent` true.

Generalize the frontier guard in `computeReviewBase` (`src/Events.ts`) so the
review frontier survives gtd-workflow commits landing on top of it:

- After identifying `lastReviewCandidate` / `lastCloseCandidate`, instead of
  only checking equality with HEAD, check whether **every commit between the
  candidate and HEAD is a gtd-workflow commit** (first-parent subjects matching
  `^plan\(gtd\):`, `^review\(gtd\):`, or `^chore\(gtd\):`). If so, the frontier
  is still effectively at the candidate — return `Option.none()` (nothing to
  review), exactly as the current equality case does.
- Concretely: add a `GitOperations` helper (e.g. `subjectsSince(ref)` returning
  the first-parent commit subjects in `ref..HEAD`), or reuse
  `git.commitMessages(base)` which already returns the messages for the stream.
  Then in `computeReviewBase`, when the chosen frontier candidate is the
  review/close commit and all subjects in `candidate..HEAD` are gtd-workflow
  prefixes, treat it as frontier-at-HEAD and return `none`.

Keep the existing exact-equality fast path; the new check is a superset of it
(an empty `candidate..HEAD` range trivially satisfies "all gtd-workflow").

### Where the change lives

- `src/Events.ts` — `computeReviewBase`: extend the frontier guard (~119-131) to
  skip a trailing run of gtd-workflow commits. This is the canonical home; the
  comment at lines ~100-101 notes `State.ts` may keep an identical copy — if a
  duplicate of this logic still exists in `src/State.ts`, apply the same change
  there (verify during implementation).
- `src/Git.ts` — add the small helper used to read `candidate..HEAD` subjects
  (only if `commitMessages` can't be reused cleanly).

### Why not fix it in the Machine guard instead?

The `humanReview` guard only sees `reviewBasePresent`/`refDiff`, which are
already-computed facts. The correct place to decide "this base has no reviewable
content" is where the base is selected — `computeReviewBase`. Fixing it in the
guard would require re-deriving the commit list there and would leave
`baseRef`/`refDiff` populated with misleading values for downstream states.

## Test plan

Follow `AGENTS.md`: add cucumber.js scenarios with small composable, generic
`Given` steps that expose the actual commits in the scenario text (one commit
per step). Cover:

1. **Regression (the bug):** Given a repo with a
   `chore(gtd): close approved review for <sha>` commit at HEAD, and Given a new
   untracked `TODO.md`, and Given gtd commits it as `plan(gtd): grilling` — When
   gtd runs again, Then the state is **not** `human-review` and **no**
   `REVIEW.md` is written.
2. **Still reviews real code:** Given a closed review at the frontier, and Given
   a non-gtd commit adding real source changes on top, When gtd runs, Then it
   **does** enter `human-review` with that code in the base diff.
3. **Mixed:** Given a closed review, then a `plan(gtd): grilling` commit, then a
   real code commit — When gtd runs, Then `human-review` fires and the real code
   is in the base diff (the plan commit is part of the range, but the presence
   of real code is what re-opens review).
4. **Unit:** direct `computeReviewBase` tests in `src/Events.test.ts` mirroring
   the above, asserting `Option.none()` when only gtd-workflow commits sit above
   the frontier and `Option.some(<closeSha>)` when real commits do.

Run the suite via the repo's configured `testCommand` (`.gtdrc`).

## Docs

Per the user's global rule, reflect this behavior change in `README.md`: note
that gtd-workflow commits (`plan/review/chore(gtd):`) landing on top of a closed
review do not re-open a review; the review frontier advances past them.

## Resolved
