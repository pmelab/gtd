# Rewrite `spec-harvest.feature` → markerless feedback feature

The `!!` harvesting convention is gone. Replace the bang-centric feature with one
that asserts the markerless rule: ANY human-review working-tree change is
feedback, and a `// !!` line is now just ordinary feedback (no special divert).

## What to do

- Rename/rewrite `tests/integration/features/spec-harvest.feature` to a
  markerless feedback feature (e.g. `spec-feedback.feature` — delete the old file
  and create the new one, OR rewrite in place; pick one and keep it consistent).
  Update the leading comment block to describe the markerless rule.
- Follow the cucumber conventions in `AGENTS.md`: composable, generic `Given`
  steps already provided in
  `tests/integration/support/steps/common.steps.ts` (`a test project`,
  `a commit "<msg>" that adds "<path>" with: """…"""`, `"<path>" is modified to:
  """…"""`, `a file "<path>" with: """…"""`). Expose actual file content in the
  scenario text.
- Scenarios to cover (all `Then it succeeds`):
  - A REVIEW.md note (all boxes ticked) routes to `review-process` — assert
    stdout contains `# Process Review Feedback` and does NOT contain
    `## Task: Close the approved review`.
  - A source edit during review (all boxes ticked, plain code/comment change,
    NO `!!`) routes to `review-process`.
  - A `// !!` comment line is now just ordinary feedback: a scenario where the
    ONLY working-tree change beyond ticks is a `// !!` line routes to
    `review-process` exactly like any other source edit — assert stdout contains
    `# Process Review Feedback`. There must be NO assertion that `!!` is special
    or harvested distinctly.
  - All boxes ticked, NOTHING else changed → `close-review` (assert
    `## Task: Close the approved review`, not `# Process Review Feedback`).
- REMOVE the old scenarios that asserted `!!`-specific divert semantics,
  added-line `!!` detection, and `TODO:`-vs-`!!` distinctions.

## IMPORTANT — match the new edge behavior

`review-process` is now EDGE-DRIVEN. When `gtd` resolves to `review-process` it
runs `recordAndRevertReview` against the real temp repo (record commit → revert →
close) and emits the SLIMMED prompt. So:
- The slimmed prompt NO LONGER contains `git revert --no-edit`,
  `docs(review): record raw feedback`, or `chore(gtd): close approved review`.
  Do NOT assert those strings. Assert on `# Process Review Feedback` and the
  synthesis/`TODO.md` instructions instead.
- The temp repo MUST be a real git repo with the REVIEW.md committed at a base so
  the edge's `git add -A` / commit / revert / close succeed and the run exits 0.
  The existing `Given` steps already create real commits, so this holds.

## Acceptance criteria

- [ ] No `!!`-specific harvesting/divert scenarios remain; `// !!` is asserted to
      behave as ordinary feedback.
- [ ] Scenarios cover review-process (note / source edit / `// !!`) and
      close-review (ticks only).
- [ ] No assertions on `git revert` / record / close commit strings in the
      review-process prompt (edge-driven now).
- [ ] `npm run test:e2e` passes for this feature.

## Files

- `tests/integration/features/spec-harvest.feature` (rewrite or replace with
  `spec-feedback.feature`)

## Constraints

- `npm run test` (vitest) does NOT run this feature; `npm run test:e2e` does.
  Still, this feature must reflect the FINAL behavior shipped in packages 02–05.
- File-disjoint from the other e2e tasks (each task owns distinct feature files).
