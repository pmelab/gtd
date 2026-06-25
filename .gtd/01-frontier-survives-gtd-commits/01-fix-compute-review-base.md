# Generalize the frontier guard in `computeReviewBase` + unit tests

## Description

Fix the bug where a new `TODO.md` committed as `plan(gtd): grilling` on top of a
closed review wrongly re-opens a review. The frontier-at-HEAD guard in
`computeReviewBase` only fires when the last review/close commit EQUALS HEAD.
Once any gtd-workflow commit lands on top, the guard fails and the close commit
becomes a review base whose diff is pure workflow noise, triggering
`human-review`.

Generalize the guard: the review frontier must survive a trailing run of
gtd-workflow commits. If EVERY commit between the review/close candidate and
HEAD has a subject matching `^plan\(gtd\):`, `^review\(gtd\):`, or
`^chore\(gtd\):`, the frontier is still effectively at the candidate — return
`Option.none()` (nothing to review).

## Implementation notes

- File: `src/Events.ts`, function `computeReviewBase` (frontier guard ~lines
  119-131).
- REUSE the existing `git.commitSubjects(base?)` helper in `src/Git.ts` — it
  already runs `git log --first-parent --reverse --format=%s <base>..HEAD` and
  returns the trimmed subjects. Do NOT add a new Git helper; the plan's
  suggestion to add `subjectsSince` is only a fallback, and `commitSubjects`
  covers it cleanly.
- Define a small predicate, e.g.
  `const isGtdWorkflowSubject = (s: string) => /^plan\(gtd\):|^review\(gtd\):|^chore\(gtd\):/.test(s)`.
- Replace the equality-only check. For each present candidate
  (`lastReviewCandidate`, `lastCloseCandidate`): if it is an ancestor of HEAD
  (or equal to HEAD) AND every subject in `candidate..HEAD` is a gtd-workflow
  subject, return `Option.none()`. An empty `candidate..HEAD` range trivially
  satisfies "all gtd-workflow", so this is a strict superset of the existing
  exact-equality fast path (keep behavior identical for the equality case).
- Keep the rest of `computeReviewBase` (candidate collection, ancestor filter,
  closest-to-HEAD pick, tie-break) unchanged.
- `State.ts` has NO `computeReviewBase` copy (verified: no `computeReviewBase` /
  `lastCloseCommit` references). Do NOT touch `State.ts`. Update the stale NOTE
  comment above `computeReviewBase` only if it still claims State.ts keeps a
  copy — leave logic-only.

## Unit tests (`src/Events.test.ts`)

Add a `describe("computeReviewBase — frontier survives gtd-workflow commits")`
block. Use a real temp git repo (mirror the existing
`gatherEvents — commitIntent and reviewDirty inference` block: `git()` helper,
`mkdtempSync`, `chdir`, `commit.gpgsign=false`). Call `computeReviewBase` via:
`Effect.runPromise(computeReviewBase(<git ops>).pipe(Effect.provide(GitService.Live), Effect.provide(NodeContext.layer)))`
after resolving `GitService` (see how `gatherEvents` is provided). Export
`computeReviewBase` is already exported.

Cover at minimum:

- A `chore(gtd): close approved review for <sha>` at HEAD, then a
  `plan(gtd): grilling` commit on top → `Option.none()` (the regression).
- Close commit, then a `plan(gtd): grilling` commit, then a real non-gtd code
  commit on top → `Option.some(<closeSha>)` (real code re-opens review; assert
  the returned ref's `..HEAD` diff includes the real code, or just assert it is
  `some`).
- Close commit exactly at HEAD (no commits on top) → `Option.none()` (existing
  equality fast path still holds).

## Acceptance criteria

- [ ] `computeReviewBase` returns `Option.none()` when the only commits between
      the last review/close candidate and HEAD are gtd-workflow commits
      (`plan|review|chore(gtd):`).
- [ ] `computeReviewBase` still returns the close/review candidate as `some`
      when a non-gtd-workflow (real code) commit sits in `candidate..HEAD`.
- [ ] The exact-equality fast path (candidate == HEAD) still returns
      `Option.none()`.
- [ ] Reuses `git.commitSubjects` — no new Git helper added.
- [ ] `State.ts` is not modified.
- [ ] New unit tests in `src/Events.test.ts` cover the three cases above.
- [ ] `npm run test` passes.

## Constraints

- Only edit `src/Events.ts` and `src/Events.test.ts`.
- Keep CLI flags / machine guards untouched — the fix lives solely where the
  base is selected, per the plan.
