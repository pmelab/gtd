---
status: grilling
---

# Refactor review-process: reference-commit + mechanical revert

## Open Questions

### Q1: Do we keep `grepBangAdded` / `bangComments`, or delete them?

**Recommendation:** **Keep the boolean signal, drop the comment extraction +
injection.** This is the load-bearing call. Two distinct uses of `!!` exist
today and they must be separated:

1. **Extraction** (`bangComments`) — `grepBangAdded` parses the diff, pulls each
   `!!` body, and `Prompt.ts:88-96` injects them as a "follow-up comments to
   harvest" section so the agent copies them into TODO.md. Under the new model
   the agent reads the **whole commit-"x" diff** (`git show <x>`), and every
   `!!` line is already a hunk in that diff. So the extraction/injection becomes
   redundant: **drop the `bangComments` passthrough from `ResolvePayload`/
   `GtdContext`, the `Prompt.ts` injection block, and the prompt's Step 4.3.**

2. **Routing guard** (`bangPresent`) — `Machine.ts:125-126`
   `reviewApprovedClose = reviewApprovedNoChanges && !bangPresent`. This is what
   diverts an otherwise-approved (forward-tick-only) REVIEW.md that has a `!!`
   in code AWAY from `close-review` and INTO `review-process`. **This guard is
   still required** and there is no cheaper replacement available at this point
   in the pipeline: by the time the resolve runs, `reviewApprovedNoChanges` is
   true only when REVIEW.md is the _only_ dirty path
   (`Events.ts:282 onlyReviewDirty`), so we cannot use "working tree dirtiness"
   to distinguish "pure approval" from "approval + leftover `!!` work" — the
   `!!` is already _committed_ in source (code-changes ran first). The only
   signal that leftover work exists is the `!!` token on a line added since the
   review-create commit, which is exactly what `grepBangAdded` computes.

   **Therefore: keep `git.grepBangAdded` but reduce it to a boolean** (or add a
   thin `git.hasBangAdded(ref): boolean` and delete the parsing). Concretely:
   keep the diff-scan + `/(\/\/|#|<!--)\s*!!/` test, return `boolean`, drop the
   `BangComment` struct, the per-comment text parsing, the `file`/`line`
   tracking, and the `bangComments` plumbing. `Events.ts:264-266` becomes
   `bangPresent = Option.isSome(reviewCommit) ? yield* git.hasBangAdded(...) : false`.

   Net: delete ~40 lines of parser in `Git.ts`, the `BangComment` interface
   (Git.ts + Machine.ts), the `bangComments` fields, and the Prompt.ts block;
   keep one boolean guard. The `spec-harvest.feature` scenarios that assert the
   `!!` _text_ appears in stdout must be rewritten to assert routing only (see
   Q5).

<!-- user answers here -->

### Q2: What does commit "x" actually capture, given `code-changes` runs first?

**Recommendation:** **Commit "x" captures ONLY the REVIEW.md edits** (plus any
untracked junk), NOT the source `!!`/illustrative edits — because by the time
`review-process` fires, source is already committed. The reviewer's verbatim
proposal assumes "x" captures the _whole_ working tree including source edits,
but the machine ordering (`codeDirty` at `Machine.ts:193` is ABOVE
`reviewModified` at `:198`) means `code-changes` commits all non-REVIEW.md/
non-TODO.md source FIRST (`Events.ts:212-215` `codeEntries`). The `code-changes`
prompt even unstages REVIEW.md (`git restore --staged REVIEW.md`,
review.feature:260) so REVIEW.md survives into the next cycle as the only dirty
path. So when `review-process` finally runs, the working tree holds **only the
REVIEW.md edits**; the `!!` and illustrative source edits are already in history
across one-or-more `code-changes` commits.

This breaks the proposal's clean "revert one commit x" story. Two viable
designs:

- **(A) Single-commit "x" via ordering change — RECOMMENDED.** Make
  `code-changes` NOT pre-commit when a modified REVIEW.md is present, so the
  reviewer's source edits + `!!` + REVIEW.md edits all reach `review-process`
  uncommitted and get squashed into ONE commit "x". Then
  `git revert --no-edit <x>` cleanly undoes everything. Implementation: reorder
  the guards so `reviewModified` (and `reviewApprovedClose`) win over
  `codeDirty` — i.e. move the `codeDirty` branch BELOW
  `reviewModified`/`reviewUnmodified`. Risk: this is a real semantic change to
  the pipeline and affects the "commit verbatim first" invariant other paths
  rely on; must re-audit every codeDirty scenario. Cleanest revert target, but
  largest blast radius.

- **(B) Revert a RANGE / keep two-phase.** Accept that source edits are already
  committed by `code-changes`. Then "x" = the raw-feedback commit (REVIEW.md
  only), and the teardown must revert BOTH the `code-changes` commit(s) AND "x".
  This requires identifying the range `reviewCreateCommit..HEAD` minus the
  TODO.md commit, and `git revert --no-edit <range>` — more revert surface, more
  conflict risk, ambiguous if multiple code-changes commits interleave.

  **Recommendation: design (A).** It is the only one that delivers the
  reviewer's stated goal ("revert commit x" undoes ALL reviewer changes) with an
  unambiguous single revert target. The plan body specs (A). If (A)'s blast
  radius is unacceptable, fall back to (B) with
  `git revert --no-edit <reviewCreateCommit>..HEAD~1` style range, excluding the
  TODO.md commit by ordering TODO.md commit LAST and reverting the range below
  it.

<!-- user answers here -->

### Q3: Is a new `git.revert` / `git.show` needed in GitOperations?

**Recommendation:** **No — keep it prompt-level.** `review-process` is a PROMPT
the agent executes, not Effect edge logic. Steps 6-8 today are literally shell
commands in `review-process.md` (`git add -A && git commit`,
`git checkout -- .`, `git clean -fd`, `rm REVIEW.md`). The existing
`checkoutTracked`/ `cleanUntracked` GitOperations methods are **dead code on
this path** — they are not invoked anywhere outside `Git.test.ts`; the reset
happens via prompt shell. So the refactor stays consistent by expressing
`git show <x>`, `git revert --no-edit <x>`, and `git rm REVIEW.md` as prompt
shell commands too. **No additions to `GitOperations`/`GitService.Live` are
required.**

Cleanup opportunity (optional, flag for user): with the reset sequence gone,
`checkoutTracked`/`cleanUntracked` become fully dead and their `Git.test.ts`
tests can be deleted. Recommend deleting them in the same change to avoid
leaving orphan IO methods.

<!-- user answers here -->

### Q4: Does `computeReviewBase`/`lastReviewCommit` still resolve a correct base after a revert teardown? And revert-conflict behavior?

**Recommendation:** **The base resolution still works, but verify the
frontier-at-HEAD short-circuit.** Today the close path writes
`chore(gtd): close approved review for <sha>` and `lastCloseCommit()`
(Git.ts:147) is a `computeReviewBase` candidate + the `headHash` short-circuit
at Events.ts:130-135 stops the loop when HEAD is a close/review commit. The new
teardown produces a different HEAD subject (a `Revert "..."` commit or a
`docs(review): ...` commit), which is NOT matched by `lastCloseCommit()`'s grep.
So **the revert teardown needs its own bookkeeping anchor** so the next cycle
does not re-diff and loop:

- Give the final teardown commit a recognized subject. Cleanest: keep emitting a
  `chore(gtd): close ...`-style marker as the LAST commit (e.g. fold the
  `git rm REVIEW.md` into a `chore(gtd): close approved review for <sha>` commit
  AFTER the revert), so `lastCloseCommit()` + the frontier short-circuit keep
  working unchanged. This preserves Q4 with zero changes to `computeReviewBase`.
- The next review base then resolves against this close commit exactly as today
  (spec-review-conclude / review.feature:333-368 regression scenarios stay
  green).

**Revert-conflict failure behavior:** the revert runs immediately on top of "x"

- the TODO.md commit (TODO.md add only), so under design (A) conflicts are
  effectively impossible (revert of the tip-1 commit). If `git revert` ever
  fails (non-clean exit), the prompt must instruct: `git revert --abort`, then
  STOP and escalate to the human (do NOT leave a half-reverted tree). Spell this
  out as an explicit failure branch in the prompt.

<!-- user answers here -->

### Q5: Which tests/specs must change, and what do they now assert?

**Recommendation:** Rewrite assertions from "reset/reset-sequence + harvest
text" to "revert + artifact-free tree":

- `review.feature:59-61` asserts `git checkout -- .` → replace with
  `git revert --no-edit`.
- `review.feature:90` asserts commit `docs(review): process review feedback` →
  keep or rename to the new teardown commit subjects.
- `review.feature:117-120` asserts `docs(review): record raw feedback for` →
  this remains (commit "x"); keep.
- `spec-harvest.feature` scenarios assert the `!!` _body text_ appears in stdout
  (e.g. "handle the empty-input edge case", "validate the config before
  running"). Under Q1's "drop extraction" decision these become invalid. Rewrite
  them to assert **routing** only: a forward-tick approval + a reviewer-added
  `!!` routes to `review-process` (NOT close-review), and the agent is told to
  read the commit-"x" diff. The "pre-review `!!` → close-review" and "plain
  `TODO:` → close-review" scenarios stay (they assert the `bangPresent` boolean
  routing, which we keep).
- `Prompt.test.ts:57-58` (review-process prompt content) and any
  bangComments-injection assertions: update for the new prompt + removed
  injection block.
- `Machine.test.ts:167-171` ("approved + !! diverts to review-process") stays —
  it asserts the `bangPresent` guard, which survives.
- `README.md` lines 61, 111, 118, 198, 264: update the review-process row, the
  `!!`/code-changes ordering note, and the mermaid edge label to describe the
  revert-based teardown.

<!-- user answers here -->

---

## Reviewer's verbatim proposal

Review feedback on the `!!` session-diff change. The reviewer proposed replacing
the current `review-process` reset mechanics with a more reliable, agent-free
model that leaves **zero** reviewer artifacts in the code. Recorded verbatim
from `REVIEW.md`:

> refactored review process:
>
> - REVIEW.md is initially created
> - user makes changes to REVIEW.md _and_ leaves `!!` comments in code
> - both are committed verbatim in a single commit for reference, no agent
>   involved (commit "x")
> - instruct agent to generate TODO.md from diff of commit "x" and commit
>   TODO.md
> - revert commit "x"
> - remove REVIEW.md
>
> that should leave no artifacts in code and provide maximum reliability

## Why

The just-shipped `!!` harvest is read-only, and the previous review-process
reset (`git checkout -- .` / `git clean -fd`) only reverts **uncommitted**
edits. But by the time `review-process` runs, the reviewer's source edits (`!!`
comments and illustrative changes) are already **committed** (the `code-changes`
leaf commits dirty source before `review-process` can fire). So those edits —
and the `!!` lines — **linger in the source history**; nothing removes them. The
agent is also asked to interpret/strip, which is unreliable. The reviewer wants
a mechanical, deterministic teardown.

## Plan body

### Goal

After a `review-process` cycle: `TODO.md` captures all feedback, and the working
tree AND history carry **no** lingering `!!`, illustrative source edits, or
REVIEW.md noise. Achieve this mechanically (no agent guessing/stripping).

### Design decisions (from Open Questions)

- **Single squashed commit "x"** (Q2 design A): `code-changes` no longer
  pre-commits when a modified REVIEW.md is present, so reviewer source edits +
  `!!` + REVIEW.md edits all land in ONE commit "x". One unambiguous revert
  target.
- **Prompt-level git** (Q3): all teardown is shell in `review-process.md`; no
  new `GitOperations` methods. Delete now-dead `checkoutTracked`/
  `cleanUntracked`.
- **Keep `bangPresent` boolean, drop `bangComments` extraction** (Q1).
- **Close-style anchor commit last** (Q4) so
  `lastCloseCommit`/`computeReviewBase` keep working and the loop terminates.

### Work items

1. **`src/Machine.ts`** — reorder guards so `reviewModified` /
   `reviewApprovedClose` win over `codeDirty` on the review path (so source
   edits are NOT pre-committed during an active review). Keep `bangPresent` in
   `reviewApprovedClose`. Remove `bangComments` from `ResolvePayload` and
   `GtdContext`; remove the `BangComment` re-export.

2. **`src/Git.ts`** — replace `grepBangAdded` (returns `BangComment[]`) with a
   boolean `hasBangAdded(ref)` (keep the added-line `!!` scan, drop body/file/
   line parsing). Remove the `BangComment` interface. Delete dead
   `checkoutTracked`/`cleanUntracked` from the interface and `Live`.

3. **`src/Events.ts`** — compute `bangPresent` from `hasBangAdded`; delete
   `bangComments` plumbing and its payload spread.

4. **`src/Prompt.ts`** — remove the `bangComments` injection block (lines
   88-96).

5. **`src/prompts/review-process.md`** — rewrite Steps 6-8 into:
   - Step A: commit "x" verbatim —
     `git add -A && git commit -m "docs(review): record raw feedback for <base>"`
     (unchanged subject; now captures source + REVIEW.md together thanks to item
     1).
   - Step B: synthesize `TODO.md` from `git show <x>` (the whole commit-"x" diff
     — REVIEW.md comments, source edits, and `!!` are all hunks), then `format`
     and commit TODO.md.
   - Step C: `git revert --no-edit <x>` (undoes all reviewer changes). On
     conflict/failure: `git revert --abort`, STOP, escalate to human.
   - Step D: `git rm REVIEW.md` and commit as
     `chore(gtd): close approved review for <short-sha>` (the recognized
     teardown anchor, Q4). Also delete Step 4.3 (`!!` harvest instructions)
     since the diff now carries it.

6. **`src/prompts/close-review.md`** — no change expected (verify the close
   anchor subject matches what `lastCloseCommit` greps).

7. **Tests** — per Q5: rewrite `review.feature` reset/`git checkout` assertions
   to revert; rewrite `spec-harvest.feature` text-harvest assertions to routing
   assertions; update `Prompt.test.ts` and delete `Git.test.ts`
   checkoutTracked/cleanUntracked tests; keep `Machine.test.ts` bangPresent
   routing tests.

8. **`README.md`** — update review-process row (line 61), the `!!`/code-changes
   ordering note (lines 111-118), the mermaid edge (line 198), and the workflow
   prose (line 264) to describe the revert-based teardown and the new ordering.

### Note on this run

This `review-process` run itself used the OLD flow. The refactor changes the
flow for FUTURE runs.

## Resolved

</content>
</invoke>
