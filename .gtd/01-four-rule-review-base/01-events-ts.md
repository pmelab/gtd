# Implement four-rule review-base logic in `src/Events.ts`

Replace the current two-candidate review-base block (merge-base vs.
`git.lastDeletionOf(REVIEW.md)`, picked by `isAncestor`) with the four rules
below. The block sits at ~lines 371–405, after `base` and `headHash` are already
computed, inside `gatherEvents`. It sets the local `reviewBase` / `refDiff` that
flow into `ResolvePayload`.

## The four rules

Definition — **within a gtd process**: there is a `gtd: grilling` commit that
happened _after_ the last process boundary (`gtd: done`, or the start of the
task cycle). Concretely: scanning `git.commitHistory()` (oldest→newest), a task
is in progress iff, after the last `gtd: done` commit (or from the beginning if
none), a `gtd: grilling` commit exists.

1. **Within a process, after first build (no review yet)** → cover the whole
   task: base = the first `gtd: grilling` commit of the current task cycle;
   `refDiff = diff(base..HEAD)`.
2. **Within a process, after review feedback + more build** → cover only changes
   since the last review: base = the last `gtd: awaiting review` commit;
   `refDiff = diff(base..HEAD)`. This takes precedence over rule 1 when an
   `gtd: awaiting review` commit exists in the current task cycle.
3. **Outside a process, on a feature branch** → cover the whole branch: base =
   `merge-base(defaultBranch, HEAD)` (the already-computed `base` Option);
   `refDiff = diff(base..HEAD)`.
4. **Outside a process, on the default branch** → skip review: leave
   `reviewBase` / `refDiff` unset (undefined) so the machine settles in Idle.

## Implementation notes

- Use `git.commitHistory()` (no base arg → ALL commits, oldest-first) to scan
  commit subjects. Match the first line of each `message`.
  - task start: `message === "gtd: grilling"` (the FIRST one after the last
    boundary = current task start)
  - last review: `message.startsWith("gtd: awaiting review")` (the LAST one in
    the current cycle)
  - boundary: `message === "gtd: done"` (resets the "within a process" scan)
- "On the default branch" ⇔ the already-computed `base` is `Option.none()`
  (merge-base is HEAD/undefined → trunk). "On a feature branch" ⇔ `base` is
  `Option.some(sha)` distinct from `headHash`.
- Compute the chosen base ref, then `git.diffRef(base)` for `refDiff`. Only set
  `reviewBase`/`refDiff` when the diff is non-empty (non-empty distinguishes
  Clean from Idle — preserve this existing behavior).
- Keep the `EMPTY_TREE` fallback for the case where a within-process base is
  expected but the ref cannot be resolved (unresolvable merge-base). Do NOT use
  EMPTY_TREE for rule 4 (default branch outside process) — that must stay unset.
- Guard the whole block behind `hasCommits` as today.
- Determine "current task cycle" commits = the slice of `commitHistory()` after
  the last `gtd: done` commit (or the full history if there is no `gtd: done`).
- Precedence within a process: rule 2 (last `awaiting review`) wins over rule 1
  (first `grilling`) when both are present in the current cycle.

## Files

- `/Users/pmelab/.herdr/worktrees/gtd/issue-24-branch-review/src/Events.ts`

## Acceptance criteria

- [ ] The two-candidate `lastDeletionOf`/`isAncestor` logic is removed and
      replaced by the four-rule logic.
- [ ] Rule 1: within a process, no `gtd: awaiting review` yet → base = first
      `gtd: grilling` of the current cycle.
- [ ] Rule 2: within a process, `gtd: awaiting review` present → base = last
      `gtd: awaiting review` of the current cycle (takes precedence over rule
      1).
- [ ] Rule 3: outside a process, feature branch → base = merge-base (`base`).
- [ ] Rule 4: outside a process, default branch → `reviewBase`/`refDiff` unset
      (Idle).
- [ ] `reviewBase`/`refDiff` only set when the resulting diff is non-empty.
- [ ] `EMPTY_TREE` retained as the fallback for an unresolvable within-process
      base only.
- [ ] `npx tsc --noEmit` passes.

## Constraints / edge cases

- Only touch the review-base block and, if needed, the `commitHistory()` call
  that feeds it (you may call `git.commitHistory()` a second time with no base —
  the existing `history` is computed with `base`, which is wrong for scanning
  across `gtd: done` boundaries on trunk). Do not alter the COMMIT-event stream
  or any other payload field.
- Do not commit anything. Leave all changes uncommitted.
- File-disjoint with the other tasks in this package: only edit `src/Events.ts`.
