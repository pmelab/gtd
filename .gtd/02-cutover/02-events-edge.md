# Task: Rewrite `src/Events.ts` as the new edge (event + payload builder)

Replace the edge so it probes git/fs and emits the new event stream the pure
resolver folds: one `COMMIT` per first-parent commit (oldest→newest) plus a
single `RESOLVE` with the new `ResolvePayload`. All git/fs IO stays here; the
machine stays pure. Part of the **atomic cutover** package (see
`01-machine-resolver.md` for the shared contract — match it exactly).

Spec pointers: `STATES.md` § Detection model + § States; `TODO.md` → "Modules to
rewrite → src/Events.ts", "Counter folds" (the `removedErrors` flag, Q2), and
Resolved Q4 (marker), Q8 (empty FEEDBACK), Q9 (review base).

## Build `COMMIT[]`

Use the new `git.commitHistory(base?)` primitive (returns `{message,
removedErrors}` per first-parent commit). For each, emit a `COMMIT` event with:
`isErrors` (subject `gtd: errors`), `isFeedback` (`gtd: feedback`),
`isPackageStart` (`gtd: planning` OR `gtd: package done`), `isWorkflowCommit`
(subject starts `gtd: `), and `removedErrors` (passthrough from
`commitHistory`). Stream base = `mergeBase(defaultBranch, HEAD)` when both
resolve, else whole history (as today).

Delete `parsePlanPhase`, `countTrailing`, the `Gtd-*` trailer regexes, the old
`commitIntent` block, and the old `isPlanGrill`/`isSpecReview`/`isAgenticReview`
flags.

## Build the `RESOLVE` payload

Produce the new `ResolvePayload` (exact fields in `01-machine-resolver.md`):

- **Steering presence:** `todoExists`, `gtdDirExists`, `reviewPresent`,
  `feedbackPresent`, `errorsPresent` (fs.exists).
- **`gtdModified`:** `.gtd/` package files added/edited in the working tree
  (porcelain entries under `.gtd/`).
- **`codeDirty`:** pending changes outside the steering set
  (`TODO.md`/`REVIEW.md`/`FEEDBACK.md`/`ERRORS.md`/`.gtd`).
- **`todoMarkerPresent`:** `<!-- user answers here -->` appears **anywhere** in
  TODO.md after stripping fenced/inline code (reuse the existing `stripCode`).
  Drop the `## Open Questions` / `### ` section parsing entirely (Q4).
- **`feedbackCommitted`** (FEEDBACK.md tracked & unmodified vs uncommitted/new)
  and **`feedbackEmpty`** (`!/\S/.test(content)`, Q8).
- **`reviewCommitted`** (REVIEW.md committed + clean) and **`reviewDirty`**
  (REVIEW.md present with pending edits, or other pending changes alongside a
  committed REVIEW.md). No checkbox / real-feedback probes — delete
  `computeReviewHasUncheckedBoxes` / `computeReviewHasRealFeedback`.
- **`pendingErrorsDeletion`:** the working tree deletes a committed `ERRORS.md`
  (porcelain `D ERRORS.md`). This is the Testing human-resume trigger — a
  status probe, distinct from the committed `removedErrors` history flag.
- **`lastCommitSubject`**, **`workingTreeClean`**, **`packages`**, **`diff`**
  (git diff HEAD incl. untracked, for prompt context).
- **Review base (`reviewBase` + `refDiff`):** feature branch → `mergeBase` with
  the default branch; default branch → `lastDeletionOf("REVIEW.md")` else root.
  Only set when `diffRef(base)` is non-empty. Replace the old
  `computeReviewBase` frontier logic and the `<!-- base: hash -->` comment
  fallback (Q9). Reuse `resolveDefaultBranch`.
- **Config passthrough:** `agenticReviewEnabled = config.agenticReview`,
  `fixAttemptCap = config.fixAttemptCap`, `reviewThreshold =
  config.reviewThreshold` (read at the edge, per AGENTS.md — caps travel as
  payload, not Context).

## Packages

Rewrite `getPackages` to drop `hasCommitMsg` and the `COMMIT_MSG.md` exclusion
in `isTaskFile` (every `.md` under a numbered dir is now a task file). Return the
new `GtdPackageFact` (`{name, tasks, taskContents}`).

## Files

- Rewrite: `src/Events.ts`
- Rewrite: `src/Events.test.ts` (assert the new COMMIT flags incl.
  `removedErrors`, the new payload fields, the marker-anywhere probe, empty
  FEEDBACK, `pendingErrorsDeletion`, and the review-base computation; reuse the
  existing Git/Config test harness)

## Constraints

- Import the resolver types (`GtdEvent`, `ResolvePayload`, `GtdPackageFact`) from
  `./Machine.js` as `import type`.
- Use only the kept + new Git primitives; do not call the soon-deleted methods.
- First-parent history only.

## Acceptance criteria

- [ ] `gatherEvents` returns `COMMIT[]` (with correct `isErrors`/`isFeedback`/
      `isPackageStart`/`isWorkflowCommit`/`removedErrors`) followed by one
      `RESOLVE` with the full new payload.
- [ ] `todoMarkerPresent` is true for a marker anywhere (incl. outside any
      section) and false when the only occurrence is inside a code fence.
- [ ] `feedbackEmpty` is whitespace-tolerant; `pendingErrorsDeletion` reflects a
      working-tree ERRORS.md deletion.
- [ ] Review base = merge-base (feature branch) / last REVIEW.md deletion
      (default branch) / root; `refDiff` only set when non-empty.
- [ ] `getPackages` no longer references `COMMIT_MSG.md`.
- [ ] `src/Events.test.ts` passes; integrates green at package completion.
