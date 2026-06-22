# Treat the latest close commit as a review-base candidate

Second code edge of the feature. After package 01 lands a
`chore(gtd): close approved review for <short-sha>` commit, the NEXT gtd run must
resolve to `verified`, not re-trigger `human-review` over the whole branch.
`computeReviewBase` already considers the merge-base and the last review commit;
add the latest close commit as a third candidate. As the closest ancestor of
HEAD it wins the tie-break, `diffRef(closeCommit, HEAD)` is empty, and the
machine falls through to `verified`.

## Files

- `src/Git.ts`
  - `GitOperations` interface (`:4-21`) — add a `lastCloseCommit` op (mirror
    `lastReviewCommit` at `:17`).
  - `GitService.Live` (`:121-133`) — implement it by copying the
    `lastReviewCommit` impl and changing the `--grep` pattern to
    `^chore\(gtd\): close approved review for`.
- `src/Events.ts`
  - `computeReviewBase` (`:72-120`) — gather the new candidate and push it into
    `rawCandidates` (alongside `lastReviewCandidate` at `:82-87`).
- `src/Git.test.ts` — add a `describe("lastCloseCommit", ...)` block mirroring
  the existing `lastReviewCommit` tests (`:183-209`).

## Implementation notes

- `lastCloseCommit` signature:
  `readonly lastCloseCommit: () => Effect.Effect<Option.Option<string>, Error>`.
- Implementation mirrors `lastReviewCommit` (`Git.ts:121-133`): same
  `git log -1 --format=%H --extended-regexp --grep=...` shape, only the grep
  pattern differs. Escape the parentheses the same way the existing op does
  (`^review\\(gtd\\): create review for` → `^chore\\(gtd\\): close approved review for`).
- In `computeReviewBase`, after `const lastReviewCandidate = yield* git.lastReviewCommit()`
  (`:82`), add `const lastCloseCandidate = yield* git.lastCloseCommit()` and push
  its value into `rawCandidates` if `Option.isSome` (mirror `:86-87`). The
  existing ancestor filter, commit-count selection, and descendant tie-break
  (`:95-117`) then handle it: the close commit is the closest ancestor of HEAD,
  so it has the smallest `commitCount` and is selected; `diffRef(closeCommit, HEAD)`
  is empty so `reviewBasePresent` stays false and the machine falls through to
  `verified`.

## Edge cases / constraints

- The exact subject prefix MUST match what package 01's close-review prompt
  commits: `chore(gtd): close approved review for `. If the prompt's subject and
  this grep ever diverge, the post-close run regresses to re-reviewing — keep
  them in lockstep.
- Do NOT remove or reorder the existing merge-base / last-review candidates; the
  close candidate is additive and competes purely on commit distance.
- When no close commit exists, `lastCloseCommit` returns `Option.none` and
  behavior is unchanged.

## Acceptance criteria

- [ ] `lastCloseCommit` declared in `GitOperations` and implemented in
      `GitService.Live`, grepping `^chore\(gtd\): close approved review for`.
- [ ] `computeReviewBase` includes the close commit as a candidate.
- [ ] `Git.test.ts` covers: none when no close commit; some with the close
      commit hash; most-recent when multiple exist (mirror `lastReviewCommit`
      tests).
- [ ] Project typechecks; existing `computeReviewBase`-dependent tests still pass.
