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

## Fix: make `human-review` auto-advance (keep Part B's edge commit)

Keep the commit as an `EdgeAction` (do NOT move it back into the agent prompt).
Make `human-review` **auto-advance** instead of stopping, so the edge commits
`REVIEW.md` BEFORE the human can touch it. The single human-review STOP becomes
two passes.

### Pass 1 — `human-review` (now auto-advance, NOT a stop)

The agent generates `REVIEW.md`, writes `.gtd-commit-intent` = `human-review`,
then **re-runs gtd**. The human never sees the uncommitted `REVIEW.md`.

- `src/Machine.ts`: give the `human-review` leaf the `auto-advance` tag (today
  it is a terminal STOP — no tag).
- `src/prompts/human-review.md`: replace the closing "STOP — do not re-run gtd"
  paragraph with the auto-advance instruction (after writing `REVIEW.md` + the
  marker, re-run gtd). Keep steps 1–6 (generate + format + write marker) as-is.

### Pass 2 — edge commit → `await-review` gate (no machine change needed)

The next gtd run detects the marker. `hasCommitIntent` already wins early in
`resolveChain` (`src/Machine.ts:242`, ahead of the review gates), so it routes
to `commit-pending`, which commits `REVIEW.md` clean as
`review(gtd): create review for <short>` and deletes the marker; the driver then
re-resolves to `await-review` (REVIEW.md committed & unmodified) → STOP and
prompt for human review. The driver loop already collapses
`commit-pending → await-review` into that one run — that IS the "detect it was
just created, commit it, prompt for review" pass.

## Why this is correct / what to verify

- **Clean-baseline invariant restored:** `REVIEW.md` is committed before the
  human edits it, so the subsequent working-vs-committed diff is a clean
  feedback diff and `review-process` / `close-review` / `review-incomplete` all
  work. The editing window that polluted the creation commit is gone because
  pass 1 auto-advances within the same agent session.
- **Termination:** pass 2 deletes the marker, so `hasCommitIntent` no longer
  fires and `await-review` is terminal — no re-loop. The defensive
  `stuckCommitPending` cap still backstops a commit that fails to clear the
  marker.
- **`restorePaths` for the `human-review` intent must stay `[]`** (do NOT
  un-stage `REVIEW.md`) so the commit actually contains it. This is the one
  place the `restorePaths: []` choice is load-bearing and correct.

## Tests + docs to update

- `src/Machine.test.ts`: the `human-review` case now carries the `auto-advance`
  tag.
- `tests/integration/features/test-gate.feature` / `edge-loop.feature`:
  human-review now auto-advances, and the FOLLOWING run yields the
  `review(gtd): create review …` commit + the `await-review` prompt (assert via
  git-log + next-prompt, not a human-review STOP).
- `README.md`: update the human-review / decision-tree description to the
  two-pass (auto-advance → edge-commit → await-review) flow.

## Open Questions

- Should the other Part B producer states be audited for the same
  "STOP-gate-vs-deferred-commit" conflict, or is `human-review` the only
  producer state that is also a STOP gate? (Quick scan: `await-answers` is a
  STOP gate but is NOT a producer in the same sense — it just waits;
  planning/execute/decompose all auto-advance already, so they commit
  immediately next run. Confirm `human-review` is the sole case.)
