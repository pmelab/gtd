# Simplify the review-process: drop `!!`/bang, gate feedback at the gtd edge

The reviewer wants the review feedback loop reduced to a single, mechanical
rule: **any change in the human-review working tree is feedback** — no marker
convention at all. The classification of feedback and the abort/finish/process
decision both move to the _edge_ (the resolver that runs when `gtd` is invoked),
so the agent prompt only ever has to turn a captured diff into a fresh
`TODO.md`.

## 1. Remove the `!!` / "bang" functionality entirely

There is no marker convention any more. Treat every kind of edit uniformly:

- Additions to `REVIEW.md` → **global** feedback.
- Code comments added in source files → **local** feedback.
- Code changes (non-comment edits) → **suggestions** that still must be
  independently verified and implemented properly (not applied verbatim).

Delete the bang plumbing:

- `grepBangAdded` / `hasBangAdded` and `BangComment` in `src/Git.ts`.
- The `bangPresent` signal in `src/Events.ts` and `ResolvePayload`.
- The `!!` injection block in `src/Prompt.ts`.
- Any prompt text in `src/prompts/review-process.md` (and the README) that
  references `!!`, "bang", or marker harvesting.

## 2. Move feedback classification + decision to the gtd edge

When `gtd` runs and a `REVIEW.md` is present, the edge decides the outcome
before emitting any prompt:

- **Unchecked boxes present** (`- [ ]` still in `REVIEW.md`) → abort and tell
  the user to check all the boxes first. Do not emit a processing prompt.
- **All boxes checked but no other changes** → abort and finish: review is done.
  Determine "no other changes" by taking the _initial_ `REVIEW.md`,
  string-replacing its checkboxes (`- [ ]` → `- [x]`), and comparing that
  against the _formatted_ new `REVIEW.md`. If they match, there is no real
  feedback — close the review.
- **Otherwise** (real feedback exists) → run the process flow below.

## 3. Process flow when real feedback exists

1. Commit the human-review feedback verbatim (whole dirty tree, `git add -A`).
2. Store the resulting commit diff in memory (so the synthesis prompt is
   self-contained and survives the revert).
3. Revert that commit and remove `REVIEW.md`.
4. Emit the stored commit diff together with the prompt that turns it into a new
   `TODO.md`.

This keeps the existing revert-based teardown but sources the synthesis prompt
from the stored diff rather than from any harvested `!!` text.

## 4. Tests + docs

- Machine/edge unit tests: pin the three edge outcomes (unchecked-boxes → abort,
  all-checked-no-changes → review-done, real-feedback → process).
- e2e features: assert the new edge gating and that no `!!`/bang harvesting
  remains; update `spec-harvest.feature` and `review.feature` accordingly.
- README: update the review section, table, and mermaid to describe the
  marker-free "any change is feedback" model and the edge decision.

## Open Questions

- Where exactly should the captured commit diff be "stored in memory" — an
  uncommitted scratch file (e.g. `.gtd/REVIEW_DIFF`), embedded directly in the
  emitted prompt string, or recovered on demand via `git show <reverted-sha>`?
  The latter avoids any new artifact but couples the prompt to the revert SHA.
- Does "store the commit diff in memory" need to survive across separate `gtd`
  invocations, or is it consumed within the same edge resolution that emits the
  prompt?
