# TODO

## Close the review loop when REVIEW.md has only ticked checkboxes

The review loop has no clean way to express "I reviewed everything and approve
it as-is, with no changes requested." Today a reviewer who checks every box in
`REVIEW.md` but writes no comments and makes no source edits has no good next
move:

- A present-but-unmodified `REVIEW.md` makes `gtd` exit with an error
  ("REVIEW.md exists but has no changes…") — `src/Events.ts:187-193`.
- Editing only checkboxes routes to **review-process** (the `reviewModified`
  guard, `src/Machine.ts:135-140`), but checkboxes are explicitly informational
  (`src/prompts/review-process.md:16-17`) — there is no feedback to fold, so
  review-process composes an empty `TODO.md` and churns the loop back into
  planning. The existing scenario
  `tests/integration/features/review.feature:92-116` ("Checkbox-only REVIEW.md …
  is processed as valid") encodes exactly this churn and must be REPLACED by
  this feature.
- Deleting `REVIEW.md` "abandons" the review and reverts the computed base to
  the merge-base with the default branch, so the next run re-reviews the entire
  branch from scratch.

Net effect today: "approved, no changes" is only achievable by manually deleting
`REVIEW.md` and committing (literally what commit `9820256` did by hand). The
state machine never resolves cleanly for a feature branch that still diffs
against its base.

### Approach

When `REVIEW.md` is modified, inspect the diff against its committed version: if
the **only** differences are **forward** checkbox ticks (`- [ ]` → `- [x]`) — no
added/removed lines, no edited prose, no un-ticks (`- [x]` → `- [ ]`), and no
non-`REVIEW.md` file dirty in the working tree — treat it as approval with
nothing to do and route to a new terminal **close-review** leaf instead of
**review-process**. That leaf's prompt discards the ticked working edits,
deletes the committed `REVIEW.md`, and commits the deletion as
`chore(gtd): close approved review for <short-sha>`. Any other `REVIEW.md`
modification — edited prose, **an un-tick** (`- [x]` → `- [ ]`, treated as
"needs more review"), or any source edit — continues to route to
**review-process** exactly as today.

### Implementation notes (keyed to files)

1. **`src/Events.ts` — detect the "only checkboxes ticked" diff.**
   - Inside the `reviewExists` block (after the `reviewModified` check at
     `:185-206`), when `reviewModified` is true, read the committed `REVIEW.md`
     (`git show HEAD:REVIEW.md`, via a small new `GitOperations` op, e.g.
     `showHead(path)`) and the working copy, and compute
     `reviewApprovedNoChanges`: true iff (a) `codeDirty` is false / the only
     dirty path is `REVIEW.md`, and (b) for every line that differs between
     committed and working versions, the committed side matches `/^- \[ \] /`
     and the working side matches `/^- \[x\] /` (a **forward tick only**) and
     the two lines are identical after normalizing the marker — with equal line
     counts and no added/removed lines. An un-tick (`[x]`→`[ ]`) therefore makes
     the predicate false and falls through to `reviewModified → review-process`.
   - Surface `reviewApprovedNoChanges: boolean` on `ResolvePayload`.
   - Also compute the close short-sha for the prompt: the first 7 chars of the
     base ref already parsed from `<!-- base: … -->` (`reviewBaseRef`, `:205`) —
     pass it through (existing `baseRef` already flows to context).

2. **`src/Machine.ts` — new leaf + guard, ordered first.**
   - Add `"close-review"` to `LeafState` (`:67-78`).
   - Add a `reviewApprovedNoChanges` guard reading
     `params.reviewApprovedNoChanges` (`:94-106`).
   - Insert a RESOLVE transition targeting `close-review` **before** the
     `reviewModified → review-process` branch (`:135-140`).
   - Register `"close-review": { tags: ["auto-advance"], type: "final" }`
     (`:193-204`) so the loop re-runs after the close commit lands.

3. **`src/Events.ts` — keep `computeReviewBase` coherent after close.**
   - Add the latest `chore(gtd): close approved review for …` commit as a base
     candidate (alongside `lastReviewCommit`), so on the run AFTER the close,
     the close commit is the closest ancestor, `diffRef(closeCommit, HEAD)` is
     empty, and the machine falls through to `verified` instead of re-triggering
     `human-review`. (See Open Question 2.)

4. **`src/Prompt.ts` + new `src/prompts/close-review.md`.**
   - Add `"close-review": closeReview` to `SECTIONS` (`:16-28`) and the import.
   - New prompt: a test-gate header (same as siblings) then steps:
     `git checkout -- REVIEW.md` (drop ticked edits) → `git rm REVIEW.md` →
     `git commit -m "chore(gtd): close approved review for <short-sha>"` → STOP
     / auto-advance re-run. `<short-sha>` comes from context `baseRef`.

5. **`src/Git.ts` — add `showHead(path)`** (`git show HEAD:<path>`) for reading
   the committed `REVIEW.md`, mirroring the existing exec wrappers.

### Test plan (cucumber per AGENTS.md)

Compose small reusable Given steps; each step = one commit; expose actual file
content in scenario text.

- **`tests/integration/features/review.feature`:**
  - REPLACE the existing "Checkbox-only REVIEW.md … is processed as valid"
    scenario (`:92-116`): same setup, but
    `Then stdout contains "chore(gtd): close approved review"` and NOT
    `"# Process Review Feedback"`.
  - New: "Un-ticking a box routes to review-process, not close" — committed
    `[x]`, working `[ ]`, asserts `# Process Review Feedback` and NOT the
    close-review prompt (forward-only predicate).
  - New: "Checkbox toggle plus a prose edit routes to review-process" — proves
    the predicate is strict (prose change ⇒ review-process, not close).
  - New: "Checkbox toggle plus a source-file edit routes to review-process" —
    `codeDirty` overrides close.
  - New: "After closing, the next run reports verified, not a fresh review" —
    apply the close commit, re-run, assert `verified` (guards Open Question 2 /
    `computeReviewBase`).
- **`src/Machine.test.ts`:** unit cases — `reviewApprovedNoChanges: true`
  resolves to `close-review` with `autoAdvance` true and WINS over
  `reviewModified: true` (ordering regression guard);
  `reviewApprovedNoChanges: false` + `reviewModified: true` still →
  `review-process`.
- **`src/Prompt.test.ts`:** `close-review` section renders its commit message
  with the base short-sha, includes the auto-advance partial, and does not leak
  another leaf's section.
- **`src/Git.test.ts`:** `showHead` returns committed content and fails cleanly
  when the path is absent at HEAD.

### Relevant code

- `src/Events.ts` — `computeReviewBase` (`:72-120`), REVIEW.md probing & "exists
  but has no changes" failure (`:181-206`), resolve payload assembly
  (`:222-241`).
- `src/Machine.ts` — guard ladder & leaf states (`:94-205`); note guards are
  priority-ordered, so `close-review` must precede `review-process`.
- `src/State.ts` — `detect()` wiring (gather → fold), unchanged.
- `src/Prompt.ts` / `src/prompts/{review-process,human-review,verified}.md` —
  prompt dispatch and the terminal/feedback copy this sits beside.

## Answered Questions

### Close path: passive `verified` vs. action-bearing leaf?

**Answer:** Add a dedicated action-bearing **close-review** leaf (auto-advance)
that discards the ticked working edits, deletes the committed `REVIEW.md`, and
commits `chore(gtd): close approved review for <short-sha>`. A passive
`verified` terminal is insufficient — it would leave the file on disk and the
next run would hit the "exists but has no changes" failure.

### Prevent `computeReviewBase` re-triggering a full-branch review after close?

**Answer:** Yes, account for it (option A). Teach `computeReviewBase` to treat
the latest `chore(gtd): close approved review for …` commit as a base candidate.
As the closest ancestor it wins the tie-break, so `diffRef(closeCommit, HEAD)`
is empty on the next run and the machine falls through to `verified`. This makes
the feature two code edges: the new leaf/prompt AND the base candidate.

### Does un-ticking a box also close?

**Answer:** No — **only forward ticks** (`- [ ]` → `- [x]`) close. An un-tick
(`- [x]` → `- [ ]`) is treated as "needs more review" and routes to
**review-process** as today. The detection predicate matches a forward tick on
every differing line; any un-tick makes it false.

### On close, commit the ticked `REVIEW.md` or just delete it?

**Answer:** Discard the ticked working edits (`git checkout -- REVIEW.md`) and
commit only the deletion (`git rm REVIEW.md`). The approval is recorded by the
close commit's message; no checkbox noise enters history. Matches commit
`9820256` and the existing review-process reset convention.
