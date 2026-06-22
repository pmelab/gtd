# TODO

## Open Questions

### Closing the loop must DELETE + COMMIT REVIEW.md, not passively resolve to `verified` — confirm the close-path needs its own action-bearing leaf/prompt.

**Recommendation:** Yes — add a dedicated action-bearing leaf (proposed
`close-review`) that deletes `REVIEW.md` and commits
`chore(gtd): close approved review for <short-sha>`, tagged `auto-advance`. A
passive resolve-to-`verified` is provably insufficient:

- A present-but-unmodified `REVIEW.md` makes `gatherEvents` hard-`Effect.fail`
  with "REVIEW.md exists but has no changes" (`src/Events.ts:187-193`). So if we
  resolved a ticked-only `REVIEW.md` to `verified` and committed nothing, the
  ticked file would still be on disk on the next run. Either the user re-runs
  with the same ticked file still dirty (→ stays on the close path, harmless but
  it never terminates), or the user `git checkout`s it clean (→ unmodified
  present file → the hard failure above). Both are bad.
- `verified.md` is a pure "report and STOP" terminal (`src/prompts/verified.md`)
  — it has no steps that mutate the tree. There is no leaf today that both
  removes a file and commits, so this must be new.
- This mirrors exactly what was done by hand in commit `9820256` ("chore(gtd):
  close approved review for 8ca9129", a 1-file deletion of REVIEW.md). Codifying
  that manual move IS the feature.

Mechanically: detection (`reviewApprovedNoChanges`) lives in `gatherEvents` (the
only place that can diff `REVIEW.md`); a new guard routes to `close-review`
**ahead of** the `reviewModified → review-process` guard
(`src/Machine.ts:135-140`), since a ticked-only diff also sets
`reviewModified: true` and would otherwise be swallowed by review-process.

<!-- user answers here -->

### After closing, will `computeReviewBase` re-trigger a full-branch `human-review` on the very next run? How do we prevent it?

**Recommendation:** It WILL re-trigger unless we account for it. After the close
commit, `computeReviewBase` (`src/Events.ts:72-120`) still finds the original
`review(gtd): create review for …` commit via `git.lastReviewCommit()`
(`src/Git.ts:121-133`) — that commit is an ancestor of HEAD and is NOT removed
by deleting `REVIEW.md`. `diffRef(reviewBase, HEAD)` would then be non-empty (it
includes at least the REVIEW.md deletion plus the originally-reviewed diff), so
the `humanReview` guard (`src/Machine.ts:104-105`,
`reviewBasePresent && refDiff.trim() !== ""`) fires and we loop straight back
into generating a fresh `REVIEW.md` for the whole branch — defeating the
approval.

Two viable fixes; **recommend (A)**:

- **(A) Make the close commit the new review boundary.** Use a commit subject
  that `lastReviewCommit`'s grep matches, OR teach `computeReviewBase` to also
  treat the latest `chore(gtd): close approved review for …` commit as a base
  candidate (preferred — keeps the existing `review(gtd):` grep semantics
  clean). Since the close commit is the closest ancestor to HEAD, the existing
  "smallest commitCount wins" tie-break (`src/Events.ts:106-117`) picks it, and
  `diffRef(closeCommit, HEAD)` is empty on the next run → falls through to
  `verified`. This is the minimal, self-consistent option.
- **(B) Resolve to `verified` only after also confirming the merge-base diff is
  empty.** Rejected: on a real feature branch the merge-base diff is the whole
  branch and is never empty until merge, so this would never reach `verified`.

So the close-review work has TWO code edges: the new leaf/prompt AND a
`computeReviewBase` candidate for the close commit.

<!-- user answers here -->

### Does un-ticking a box (`- [x]` → `- [ ]`) also count as "only checkbox changes → close", or only forward ticks?

**Recommendation:** Treat ANY change confined to checkbox markers as a close, in
either direction. The detection predicate is "every changed line differs from
its committed counterpart only in the `[ ]`/`[x]` marker, and no lines are
added/removed and no non-REVIEW.md file is dirty." Direction is irrelevant
because `review-process.md` already states checkboxes are "informational only;
do not treat checked/unchecked as approval or rejection"
(`src/prompts/review-process.md:16-17`) — so an un-tick carries no actionable
feedback either, and routing it to `review-process` would compose an empty
`TODO.md` and churn. Closing on any checkbox-only diff is the consistent rule.
(If the user disagrees and wants un-ticks to mean "more review needed," we'd
restrict the predicate to forward `[ ]`→`[x]` toggles only.)

<!-- user answers here -->

### On close, commit the ticked `REVIEW.md` content, or just delete it?

**Recommendation:** Just delete it (single-file deletion), matching commit
`9820256` which deleted `REVIEW.md` outright with no preserved approval record.
Reasons: (1) the approval IS recorded — by the close commit's existence and
message; (2) `review-process.md`'s own reset sequence
(`src/prompts/review-process.md:60-86`) discards the working `REVIEW.md` and
commits only its deletion, so "delete, don't preserve edits" is the established
convention; (3) keeping ticked checkboxes around adds a stale artifact that
`computeReviewBase` would have to reason about. The close commit must therefore
first `git checkout -- REVIEW.md` (drop the ticked working edits) then
`git rm REVIEW.md`, so the only committed change is the deletion of the
committed version — no checkbox noise in history.

<!-- user answers here -->

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
the **only** differences are checkbox-marker toggles (`- [ ]` ⇄ `- [x]`) — no
added/removed lines, no edited prose, and no non-`REVIEW.md` file dirty in the
working tree — treat it as approval with nothing to do and route to a new
terminal **close-review** leaf instead of **review-process**. That leaf's prompt
discards the ticked working edits, deletes the committed `REVIEW.md`, and
commits the deletion as `chore(gtd): close approved review for <short-sha>`. Any
other `REVIEW.md` modification (prose, edited explanations) or any source edit
continues to route to **review-process** exactly as today.

### Implementation notes (keyed to files)

1. **`src/Events.ts` — detect the "only checkboxes ticked" diff.**
   - Inside the `reviewExists` block (after the `reviewModified` check at
     `:185-206`), when `reviewModified` is true, read the committed `REVIEW.md`
     (`git show HEAD:REVIEW.md`, via a small new `GitOperations` op, e.g.
     `showHead(path)`) and the working copy, and compute
     `reviewApprovedNoChanges`: true iff (a) `codeDirty` is false / the only
     dirty path is `REVIEW.md`, and (b) every line that differs between
     committed and working versions matches `/^- \[[ x]\] /` on BOTH sides and
     is identical after normalizing the marker to `[ ]`, with equal line counts.
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
  - New: "Un-ticking a box also closes the review" — committed `[x]`, working
    `[ ]`, asserts close-review prompt.
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
