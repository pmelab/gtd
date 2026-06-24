---
status: complete
---

# Refactor review-process: reference-commit + mechanical revert

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

- **Single commit "x" captures everything** (Q2): code changes are not allowed
  in the review process. While a `REVIEW.md` is present, `code-changes` must NOT
  fire/pre-commit source — the entire dirty working tree (source edits + `!!` +
  `REVIEW.md` edits) is squashed into ONE reference commit "x" by
  `review-process`. `git revert --no-edit <x>` then cleanly undoes everything.
- **Prompt-level git** (Q3): all teardown is shell in `review-process.md`; no
  new `GitOperations` methods. Delete now-dead `checkoutTracked`/
  `cleanUntracked`.
- **Keep `bangPresent` boolean, drop `bangComments` extraction** (Q1).
- **Close-style anchor commit last** (Q4) so
  `lastCloseCommit`/`computeReviewBase` keep working and the loop terminates.

### Q2 guard change (verified against the machine)

The current RESOLVE guard order in `src/Machine.ts` `replaying` (the `RESOLVE`
array, lines ~181-256) is: `errorsPresent`(:183) → `reviewApprovedClose`(:188) →
`codeDirty`(:193) → `reviewModified`(:198) → `reviewUnmodified`(:203) → … . The
`codeDirty` guard (:129 / :193) fires whenever any path outside `TODO.md`/
`REVIEW.md` is dirty (`Events.ts:212-215` `codeEntries`), and it sits ABOVE the
review branches — so today a dirty source file pre-empts the review path.

**The exact change:** gate `codeDirty` on the absence of a `REVIEW.md`. Add a
new payload boolean `reviewPresent` (= `reviewExists` already computed at
`Events.ts:254`) to `ResolvePayload`, and change the `codeDirty` guard to fire
only when no review is in progress:

```ts
codeDirty: (_, params: ResolvePayload) => params.codeDirty && !params.reviewPresent,
```

Keep the guard array order unchanged (no reorder needed). With `codeDirty` now
inert while `REVIEW.md` exists, the review branches below it
(`reviewApprovedClose`, `reviewModified`, `reviewUnmodified`) take over the
review path; when there is NO `REVIEW.md`, `reviewPresent` is false and
`codeDirty` behaves exactly as before.

Traced scenarios (the two that pin the design):

- **REVIEW.md modified with a note AND a dirty source file.** `codeDirty`=true,
  `reviewPresent`=true, `reviewModified`=true, `reviewApprovedNoChanges`=false
  (a note, not pure ticks). Old order → `code-changes` (WRONG). New gate:
  `codeDirty` is suppressed (`reviewPresent`), `reviewApprovedClose` is false,
  so it falls to `reviewModified` → **`review-process`**. Then commit "x"
  (`git add -A`) captures BOTH the source edit and the REVIEW.md note. ✓
- **REVIEW.md committed-unmodified + dirty source (no feedback recorded yet).**
  `reviewModified`=false, `reviewUnmodified`=true (`Events.ts:259`),
  `reviewPresent`=true, `codeDirty`=true. New gate: `codeDirty` suppressed,
  `reviewApprovedClose`/`reviewModified` false, so → `reviewUnmodified` →
  **`await-review`** (the human gate). DECISION: this is correct — the human is
  mid-review; their in-progress source edits are unrecorded feedback and must
  wait at the human gate, not be pre-committed by `code-changes`. This
  reconciles "code changes not allowed in the review process" with the
  `await-review` gate: the gate simply holds; nothing is committed until the
  human records feedback (touches REVIEW.md → next cycle routes to
  `review-process`, commit "x").

**Non-review `code-changes` path is preserved:** with no `REVIEW.md`,
`reviewModified`/`reviewUnmodified`/`reviewApprovedNoChanges`/`bangPresent` are
all false and `reviewPresent`=false, so `reviewApprovedClose` cannot fire and
`codeDirty` fires normally → `code-changes`. The verbatim-first invariant for
ordinary work is untouched.

`Machine.test.ts` adds a `reviewPresent: false` default to its
`resolveEvent`/payload fixture (mirroring the existing `bangPresent: false` at
:18) and gains a scenario for each traced case above.

### Work items

1. **`src/Machine.ts`** — Q2: add `reviewPresent: boolean` to `ResolvePayload`
   (alongside the other review booleans ~:41-63) and change the `codeDirty`
   guard (:129) to `params.codeDirty && !params.reviewPresent` (array order
   unchanged). Q1: remove the `BangComment` interface (:16-21), the
   `bangComments?` fields from `ResolvePayload` (:71) and `GtdContext` (:87),
   and the `bangComments` spread in `applyPayload` (:169). Keep `bangPresent`
   (:61) and the `reviewApprovedClose` guard
   `reviewApprovedNoChanges && !bangPresent` (:125-126).

2. **`src/Git.ts`** — replace `grepBangAdded` (returns `BangComment[]`,
   :228-292) with a boolean `hasBangAdded(ref): Effect<boolean, Error>`: keep
   the untracked intent-to-add + `git diff baseRef -- :!REVIEW.md :!TODO.md`
   scan, return `true` on the first added (`+`) line matching
   `/(\/\/|#|<!--)\s*!!/`, else `false`; drop the hunk-header parsing,
   `file`/`line`/`text` extraction, and the `BangComment` result. Remove the
   `BangComment` interface (:27-33) and the `grepBangAdded` signature (:24); add
   the `hasBangAdded` signature. Delete dead `checkoutTracked` (:12, :99-100)
   and `cleanUntracked` (:13, :102) from the interface and `Live` — they are
   unused on every path (only `Git.test.ts` referenced them). Leave
   `lastCloseCommit` (:147-159) and its grep
   `^chore\(gtd\): close approved review for` untouched — the Q4 teardown anchor
   must match this pattern exactly.

3. **`src/Events.ts`** — drop the `BangComment` type import (:3). Replace the
   `bangComments` plumbing (:252, :265-266) with
   `bangPresent = Option.isSome(reviewCommit) ? yield* git.hasBangAdded(reviewCommit.value) : false`
   (remove the `let bangComments` declaration). Set
   `reviewPresent: reviewExists` in the `ResolvePayload` (the `reviewExists`
   value at :254 is in scope at the payload literal). Remove the
   `...(bangComments.length > 0 ? { bangComments } : {})` spread (:350).
   Unchanged: `codeEntries`/`codeDirty` (:212-215), `commitMessages` (:195),
   `computeReviewBase`/`lastReviewCommit`/ `lastCloseCommit` (:107-171, :264) —
   Q4 base bookkeeping is unaffected.

4. **`src/Prompt.ts`** — remove the `bangComments` injection block (:88-96, the
   "`!!` follow-up comments (leftover work to harvest)" section).

5. **`src/prompts/review-process.md`** — rewrite the teardown. Delete the Step 4
   item 3 "`!!` follow-up comments" harvest paragraph (:42-49) and adjust Step 4
   to two sources (REVIEW.md comments + source edits, both now read from the
   commit-"x" diff). Replace Steps 6-8 (:64-120) with:
   - **Step 6 — commit "x" verbatim:** read the `<!-- base: … -->` ref, then
     `git add -A && git commit -m "docs(review): record raw feedback for <base>"`
     — this now captures source edits + `!!` + REVIEW.md together (Q2: code was
     never pre-committed during the review).
   - **Step 7 — synthesize TODO.md from the commit-"x" diff:** `git show <x>`
     (or `git diff <x>^ <x>`) is the single source of all feedback (REVIEW.md
     comments, source edits, `!!` lines are all hunks). Compose `TODO.md`, run
     `node scripts/gtd.js format TODO.md`, then `git add TODO.md && git commit`.
   - **Step 8 — mechanical teardown:** `git revert --no-edit <x>` to undo all
     reviewer changes. **On conflict/non-clean exit:** run `git revert --abort`,
     then STOP and escalate to the human — do NOT leave a half-reverted tree
     (explicit failure branch). On success, if `REVIEW.md` still tracked run
     `git rm REVIEW.md`, then commit the final anchor
     `chore(gtd): close approved review for <short-sha>` (the recognized
     `lastCloseCommit` anchor, Q4 — terminates the loop via the frontier-at-HEAD
     short-circuit, `Events.ts:130-135`). Remove the old Step 7
     `git checkout -- .` / `git clean -fd` / `rm REVIEW.md` reset sequence
     entirely.

6. **`src/prompts/close-review.md`** — verify only; its close anchor subject
   must already match `^chore\(gtd\): close approved review for` (no change
   expected).

7. **Tests** (Q5):
   - `tests/integration/features/review.feature`: replace the
     `git checkout -- .` assertion (:61) with `git revert --no-edit`;
     update/keep the teardown commit assertion at :90 (was
     `docs(review): process review feedback into TODO.md`) to the new final
     anchor `chore(gtd): close approved review`; keep the commit "x" assertion
     `docs(review): record raw feedback for` (:120). Add a scenario: REVIEW.md
     modified with a note + a dirty source file routes to `review-process`
     (asserting the source edit lands in commit "x" and the reverted tree is
     artifact-free), NOT `code-changes`.
   - `tests/integration/features/spec-harvest.feature`: rewrite the scenarios
     that assert `!!` body text in stdout (the harvested-text assertions) to
     assert **routing only** — a forward-tick approval + a reviewer-added `!!`
     routes to `review-process` (not `close-review`), and the prompt tells the
     agent to read the commit-"x" diff; assert the reverted tree carries no `!!`
     artifact. Keep the "pre-review `!!` → close-review" and "plain `TODO:` →
     close-review" scenarios (they exercise the surviving `bangPresent`
     boolean).
   - `src/Prompt.test.ts`: the review-process content test (:57-61) must no
     longer assert the injected `!!` follow-up section; assert the new teardown
     text (`git revert --no-edit`, `format TODO.md`) instead. No `bangComments`
     injection assertions remain.
   - `src/Machine.test.ts`: add `reviewPresent: false` to the payload fixture
     default (next to `bangPresent: false`, :18); keep the bangPresent routing
     test (:167-171); add the two Q2 traced scenarios (note+dirty →
     `review-process`; unmodified-review+dirty → `await-review`).
   - `src/Git.test.ts`: delete the `checkoutTracked` (:87-103) and
     `cleanUntracked` (:105-…) describe blocks; rewrite the `grepBangAdded`
     describe (:355-…) to `hasBangAdded`, asserting `true`/`false` instead of a
     `BangComment[]`.

8. **`README.md`** — update the review-process row (:61) and the `code-changes`
   row (:60) / ordering note (:109-118): describe the revert-based teardown and
   that code changes are NOT pre-committed while a `REVIEW.md` is present (drop
   the "reviewer's edits reach review-process already committed" sentence at
   :118 — that is now false). Update the mermaid edges (:196-198) and the
   workflow prose (:260-264) to reflect: while reviewing, source edits are NOT
   committed; an approval with leftover `!!` or any note routes to
   `review-process`, which records commit "x", synthesizes `TODO.md`, then
   `git revert`s "x" and closes — leaving no artifact.

### Note on this run

This `review-process` run itself used the OLD flow. The refactor changes the
flow for FUTURE runs.

## Resolved

### Q1: Do we keep `grepBangAdded` / `bangComments`, or delete them?

**Recommendation:** **Keep the boolean signal, drop the comment extraction +
injection.** `bangComments`/`BangComment` and the `Prompt.ts` injection block
become redundant once the agent reads the whole commit-"x" diff (`git show <x>`)
— every `!!` line is already a hunk there. Drop `bangComments`/`BangComment`/the
`Prompt.ts:88-96` injection/the prompt Step 4 item-3 harvest text. KEEP a
boolean `hasBangAdded(ref)` (reduce `grepBangAdded` to the `!!` scan returning
`boolean`) because `bangPresent` still diverts a forward-tick-only approval into
`review-process` via
`reviewApprovedClose = reviewApprovedNoChanges && !bangPresent`
(`Machine.ts:125-126`).

**Answer:** agreed

### Q2: What does commit "x" actually capture, given `code-changes` runs first?

**Recommendation:** **Single squashed commit "x" via an ordering change** so the
reviewer's source edits + `!!` + REVIEW.md edits all reach `review-process`
uncommitted and revert as one target.

**Answer:** no, commit "x" captures everything. code changes are not allowed in
the review process

### Q3: Is a new `git.revert` / `git.show` needed in GitOperations?

**Recommendation:** **No — keep it prompt-level.** `git show`/
`git revert --no-edit`/`git rm` stay shell commands in `review-process.md`; no
additions to `GitOperations`. Delete the now-dead `checkoutTracked`/
`cleanUntracked` methods + their `Git.test.ts` tests.

**Answer:** agreed

### Q4: Does `computeReviewBase`/`lastReviewCommit` still resolve a correct base after a revert teardown? And revert-conflict behavior?

**Recommendation:** Teardown must END with a recognized
`chore(gtd): close approved review for <sha>` anchor commit so
`lastCloseCommit()`/`computeReviewBase` resolve and the frontier-at-HEAD
short-circuit terminates the loop. On revert CONFLICT, `git revert --abort`,
STOP, and escalate to the human (explicit failure branch in the prompt).

**Answer:** agreed

### Q5: Which tests/specs must change, and what do they now assert?

**Recommendation:** Rewrite assertions from "reset-sequence + harvested `!!`
text" to "revert + artifact-free reverted tree" and routing assertions:
`review.feature` (`git checkout` → `git revert --no-edit`, teardown anchor),
`spec-harvest.feature` (routing not harvested text), `Prompt.test.ts` (new
teardown text, no injection), `Machine.test.ts` (keep bangPresent, add
`reviewPresent` cases), `Git.test.ts` (drop `checkoutTracked`/`cleanUntracked`,
adapt `hasBangAdded`), `README.md` wording.

**Answer:** agreed
