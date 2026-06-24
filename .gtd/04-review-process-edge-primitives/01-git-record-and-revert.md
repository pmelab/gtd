# New GitService write op `recordAndRevertReview` (`src/Git.ts`)

Add the write-side operation that, within a single `gtd` execution, records the
reviewer's verbatim working tree as a commit, captures its diff, reverts it, and
closes the review. The captured diff is returned for injection into the prompt.

## What to do (`src/Git.ts`)

1. Add to the `GitOperations` interface:
   `readonly recordAndRevertReview: (base: string) =>
   Effect.Effect<{ readonly diff: string; readonly recordSha: string }, Error>`
   with a doc comment describing the commit → capture → revert → close sequence.

2. Implement it in `GitService.Live`. Within one Effect:
   - `git add -A`, then `git commit -m "docs(review): record raw feedback for
     <base>"` (verbatim — annotated REVIEW.md, source edits, untracked files).
     `<base>` is the full `base` argument (the `reviewBaseRef` parsed from
     `REVIEW.md`'s `<!-- base: … -->`, threaded in by `main.ts`).
   - Capture `<record-sha>` via `git log -1 --format=%H` (or `git rev-parse HEAD`)
     and the diff via `git show <record-sha>` into in-process strings.
   - `git revert --no-edit <record-sha>`. On NON-ZERO exit / conflict: run
     `git revert --abort` inside the same op, then `Effect.fail(new Error(...))`
     with a clear message (e.g. "review-process: revert conflict reverting
     <record-sha>; aborted. ..."). Use `Command.exitCode` (like the existing
     `isAncestor`/`showHead` impls) to detect non-zero rather than relying on
     `Command.string` throwing.
   - On CLEAN revert: if `REVIEW.md` is still tracked, `git rm REVIEW.md`, then
     `git commit -m "chore(gtd): close approved review for <short-sha>"` where
     `<short-sha>` is `base.slice(0, 7)` (matches the `lastCloseCommit` grep
     `^chore\(gtd\): close approved review for`).
   - Return `{ diff, recordSha }`.

3. Do not introduce any scratch file — the diff lives in process memory only.

## Tests (same task — `src/Git.test.ts`)

Add a `describe("recordAndRevertReview", …)` block against a real temp repo:
- [ ] Happy path: stage a dirty REVIEW.md + a source edit, run the op; assert the
      returned `diff` contains the changes, a `docs(review): record raw feedback
      for <base>` commit exists, a `chore(gtd): close approved review for
      <short-sha>` commit exists, REVIEW.md is removed, and the working tree is
      clean after (record + revert + close all committed).
- [ ] Revert-conflict path: construct a tree where reverting the record commit
      conflicts (e.g. a later commit on top that touches the same lines), run the
      op; assert it `Effect.fail`s and that `git revert --abort` left no
      in-progress revert (`.git/REVERT_HEAD` absent / `git status` clean of the
      revert state). Use the `runEither`/`Either` pattern already in
      `Git.test.ts`.

## Acceptance criteria

- [ ] `recordAndRevertReview(base)` added to interface + `Live`, returning
      `{ diff, recordSha }`.
- [ ] Clean path: record commit, capture diff, revert, `git rm REVIEW.md`, close
      commit with `base.slice(0,7)`.
- [ ] Conflict path: `git revert --abort` + `Effect.fail`.
- [ ] `src/Git.test.ts` covers both paths.
- [ ] `npm run test` green.

## Files

- `src/Git.ts`
- `src/Git.test.ts`

## Constraints / edge cases

- DEPENDS ON package 03 (`hasBangAdded` already removed) only for cleanliness;
  the real dependency is none beyond a baseline `Git.ts`. Ordered after 03 so
  `Git.ts` is touched by one package at a time.
- This op is NOT called by anything yet — `main.ts` wires it in package 05. That
  is fine: an unused interface member + impl compiles and is unit-tested here.
- File-disjoint from the Prompt/State task (task 02) in this package.
- Match the existing executor-provision pattern (`Effect.provide(Layer.succeed(
  CommandExecutor.CommandExecutor, executor))`) used by `isAncestor`/`showHead`.
