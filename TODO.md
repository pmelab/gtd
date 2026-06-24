---
status: complete
---

# Split human-review so the edge commits a CLEAN REVIEW.md baseline

Review feedback on the edge-offload branch (recovered from the recorded review
commit `b34a4f2`). Fixes the human-review timing flaw introduced by Part B
(generalized post-agent commit) without abandoning Part B's edge-commit pattern.

## Problem

Part B made `human-review` leave `REVIEW.md` **uncommitted** plus a
`.gtd-commit-intent` marker, then **STOP**, deferring the commit to the next gtd
run's edge (`commit-pending`). But `human-review` is unique: it is a producer
state that is **also a human STOP gate**, and its output must be a
committed-**clean** baseline for the diff-based review detection
(`review-process` / `close-review` / `review-incomplete`) to work.

Because the agent stops with `REVIEW.md` uncommitted, the human edits it during
the gate window; on the next run the edge commits `REVIEW.md` **with the human's
edits already baked into** the `review(gtd): create review …` commit. The
working-vs-committed diff is then empty, so the review detection misfires and
the feedback is lost.

## Precedent: the planning flow already does this (mirror it)

The `TODO.md` planning loop is NOT affected by this bug because it already
implements the exact two-pass split we are adding to review. Use it as the
template:

- Producers `new-todo` / `modified-todo` carry `tags: ["auto-advance"]`
  (`src/Machine.ts:481-482`), so after they write `TODO.md` + the marker they
  re-run gtd and the edge's `commit-pending` commits `TODO.md` **clean** in the
  same session.
- The gate `await-answers` is `{ type: "final" }` with no tag
  (`src/Machine.ts:483`) and its guard requires a committed-clean file:
  `todoStatus === "grilling" && todoDirty === null && todoOpenQuestionsPresent`
  (`todoAwaitAnswers`, `src/Machine.ts:296-299`).
- The human edits the committed-clean `TODO.md` → `todoDirty === "modified"` →
  `todoRegrill` → `modified-todo`. Clean working-vs-committed diff; no
  pollution.

`human-review` is the ONLY producer leaf that is itself `type: "final"`
(`src/Machine.ts:484`, no `auto-advance` tag) — that is exactly why it is the
sole broken case. The fix makes review structurally identical to planning:
auto-advancing producer (`human-review`) → edge commit → separate gate
(`await-review`).

## Fix: make `human-review` auto-advance (keep Part B's edge commit)

Keep the commit as an `EdgeAction` (do NOT move it back into the agent prompt).
Make `human-review` **auto-advance** instead of stopping, so the edge commits
`REVIEW.md` BEFORE the human can touch it. The single human-review STOP becomes
two passes — mirroring the planning precedent above.

### Pass 1 — `human-review` (now auto-advance, NOT a stop)

The agent generates `REVIEW.md`, writes `.gtd-commit-intent` = `human-review`,
then **re-runs gtd**. The human never sees the uncommitted `REVIEW.md`.

- `src/Machine.ts`: give the `human-review` leaf the `auto-advance` tag (today
  it is a terminal STOP — no tag).
- `src/prompts/human-review.md`: replace the closing STOP paragraph (lines
  70–72: "…**STOP**. Do not re-run gtd…") with the auto-advance instruction,
  mirroring the precedent prompts' phrasing (`new-todo.md:72`,
  `modified-todo.md:81`): "Re-run gtd — the next cycle commits `REVIEW.md` and
  deletes the marker." Keep steps 1–6 (generate + format + write marker) as-is;
  step 6's note (lines 66–68) already describes the edge commit and stays.

### Pass 2 — edge commit → `await-review` gate (no machine change needed)

The next gtd run detects the marker. `hasCommitIntent` already wins early in
`resolveChain` (`src/Machine.ts:242`, ahead of the review gates), so it routes
to `commit-pending`. For the `human-review` intent the edge action is
`{ kind: "commitPending", restorePaths: [] }` (`commitActionForIntent`,
`src/Machine.ts:159-161`) and the message is derived as
`review(gtd): create review for <short>` (`deriveCommitMessage`,
`src/Git.ts:108-111`). The marker (`.gtd-commit-intent`, read in
`src/Events.ts:312`) is deleted by the commit; the driver then re-resolves to
`await-review` (REVIEW.md committed & unmodified) → STOP and prompt for human
review. The driver loop already collapses `commit-pending → await-review` into
that one run — that IS the "detect it was just created, commit it, prompt for
review" pass.

## Why this is correct / what to verify

- **Clean-baseline invariant restored:** `REVIEW.md` is committed before the
  human edits it, so the subsequent working-vs-committed diff is a clean
  feedback diff and `review-process` / `close-review` / `review-incomplete` all
  work. The editing window that polluted the creation commit is gone because
  pass 1 auto-advances within the same agent session.
- **Termination (VERIFIED — no infinite human-review loop):** see the
  guard-order trace in `## Resolved`. Two independent facts make the post-commit
  resolution land on `await-review`, NOT `human-review` again: (a) `humanReview`
  requires `reviewBasePresent && refDiff non-empty` (`src/Machine.ts:309-310`),
  but once the `review(gtd): create review …` commit IS HEAD,
  `computeReviewBase`'s frontier-at-HEAD guard (`src/Events.ts:176-181`) returns
  `Option.none()` → `reviewBasePresent = false`, so `humanReview` cannot fire;
  and (b) even setting that aside, `reviewUnmodified` (chain position 4,
  `src/Machine.ts:247`) sits far AHEAD of `humanReview` (last real guard,
  `src/Machine.ts:265`), and a committed-clean REVIEW.md makes
  `reviewUnmodified === true` (`src/Events.ts:332-335`) → `await-review` wins.
  Pass 2 also deletes the marker, so `hasCommitIntent` no longer fires; the
  defensive `stuckCommitPending` cap (`src/Machine.ts:327-328`) still backstops
  a commit that fails to clear the marker.
- **`restorePaths` for the `human-review` intent must stay `[]`** (do NOT
  un-stage `REVIEW.md`) so the commit actually contains it. This is the one
  place the `restorePaths: []` choice is load-bearing and correct.

## Tests + docs to update

- `src/Machine.test.ts`: flip the existing assertion at lines 233–243 ("clean +
  reviewBasePresent + non-empty refDiff → human-review, **autoAdvance false**")
  to expect `autoAdvance true` — `human-review` now carries the `auto-advance`
  tag.
- `tests/integration/features/auto-advance.feature` (lines 65–81): the scenario
  "Human-review prompt contains STOP and no auto-advance" **inverts** under this
  fix. Rename/rewrite it so the human-review prompt now asserts auto-advance:
  `stdout contains` the re-run-gtd instruction and `stdout does not contain`
  "STOP" (instead of the current `contains "STOP"` +
  `does not contain "Re-run gtd immediately"`). NOTE: the current
  `does not contain "Re-run gtd immediately"` check is incidental — the real
  precedent prompts say "Re-run gtd — the next cycle commits …"; assert against
  that actual phrasing.
- `tests/integration/features/test-gate.feature`: existing scenarios pre-date a
  committed REVIEW.md and only assert the Pass-1 prompt is produced (no
  STOP/auto-advance claim) — they stay valid as-is. OPTIONALLY add one scenario
  proving Pass 2: after a human-review run leaves the marker + uncommitted
  `REVIEW.md`, the FOLLOWING run yields the `review(gtd): create review …`
  commit and the `await-review` prompt (assert via last-commit-subject +
  next-prompt). (`edge-loop.feature` has NO human-review/await-review references
  — the earlier plan named it in error; do not touch it.)
- `README.md`: update the human-review row in the leaf table (line 94, currently
  "Generate `REVIEW.md` (no test gate — settles directly)") and the
  decision-tree mermaid edge (line 259, currently `HumanReview[…]:::terminal`)
  to the two-pass (auto-advance → edge-commit → await-review) flow;
  `human-review` is no longer a terminal STOP leaf. The `await-review` row
  (line 83) stays the human STOP gate.

## Resolved

- **Is `human-review` the only producer state that is also a STOP gate?** **Yes
  — confirmed in code.** Every other producer (`new-todo`, `modified-todo`,
  `execute`, `decompose`, `execute-simple`) carries the `auto-advance` tag, so
  its deferred commit lands in the same session before any human gate. The two
  STOP gates (`await-answers`, `await-review`) are gate-only and their guards
  require a committed-clean file (`todoDirty === null` / `reviewUnmodified`).
  `human-review` is the lone producer leaf declared `type: "final"` with no
  `auto-advance` tag, so it is the only place the Part B deferred-commit exposes
  an uncommitted baseline across a human-edit window. No further audit needed;
  `TODO.md` is unaffected.

- **Does auto-advancing `human-review` terminate cleanly (no infinite
  human-review → commit → human-review loop), and is the post-commit state
  `await-review`? YES — verified against the code.** Concrete `resolveChain`
  guard order (`src/Machine.ts:234-266`):
  `errorsPresent → [stuckCommitPending] → hasCommitIntent → [stuckCodeChanges] → codeDirty → reviewUnmodified → reviewIncomplete → [stuckCloseReview] → closeReview → reviewModified → hasPackages → … → todoAwaitAnswers → todoRegrill → todoInitial → humanReview → verified`.
  Trace of the loop:
  1. Pass 1: `humanReview` fires (clean tree, `reviewBasePresent` true,
     `refDiff` non-empty); the leaf (now `auto-advance`) re-runs gtd with the
     marker + uncommitted `REVIEW.md`.
  2. Pass 2 resolution sees the marker → `hasCommitIntent` (position 3) wins,
     ahead of every review gate → `commit-pending` commits `REVIEW.md`
     (`restorePaths: []`) as `review(gtd): create review for <short>` and
     deletes the marker.
  3. Re-resolution after the commit: marker gone → `hasCommitIntent` false.
     Critically, the new HEAD IS the `review(gtd): …` commit, which
     `git.lastReviewCommit()` (`src/Git.ts:293`) matches, so
     `computeReviewBase`'s frontier-at-HEAD guard (`src/Events.ts:176-181`)
     returns `Option.none()` → `reviewBasePresent = false` → `humanReview`
     CANNOT fire. Independently, `REVIEW.md` is now committed and unmodified →
     `reviewUnmodified = true` (`src/Events.ts:332-335`), and `reviewUnmodified`
     sits at chain position 4 — far ahead of `humanReview` at the tail. Either
     fact alone routes to **`await-review`** (terminal STOP), never back to
     `human-review`. Loop terminates in exactly two passes, identical in shape
     to the planning flow's `new-todo → commit-pending → await-answers`.

- **File count → `status: complete` (6 files, > 5).** `src/Machine.ts`,
  `src/prompts/human-review.md`, `src/Machine.test.ts`,
  `tests/integration/features/auto-advance.feature`,
  `tests/integration/features/test-gate.feature`, `README.md`. The two feature
  files (one mandatory inversion in `auto-advance.feature`, one optional Pass-2
  scenario in `test-gate.feature`) push the count past 5, so this is `complete`,
  not `simple`. No implementation-changing open questions remain.
