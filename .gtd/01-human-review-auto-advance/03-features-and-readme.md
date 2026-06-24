# Invert the e2e STOP scenario, add optional Pass-2 scenario, update README

Reflect the auto-advance behavior in the e2e features and the docs. The
human-review prompt is no longer a terminal STOP — it now auto-advances, the edge
commits `REVIEW.md`, and `await-review` becomes the human STOP gate.

This task is vitest-neutral (it changes only feature files + README, exercised by
`npm run test:e2e`, not vitest). It is file-disjoint from the Machine task and
the prompt task in this package, so all three run in parallel.

## Files (exclusive to this task)

- `tests/integration/features/auto-advance.feature`
- `tests/integration/features/test-gate.feature`
- `README.md`

## What to do — `auto-advance.feature` (lines 65–81) — MANDATORY inversion

The scenario "Human-review prompt contains STOP and no auto-advance" now INVERTS.
Rename it (e.g. "Human-review prompt auto-advances and contains no STOP") and flip
its final assertions:

- Keep `And stdout contains "## Task: Generate REVIEW.md"`.
- Replace `And stdout contains "STOP"` with an assertion that the prompt now tells
  the agent to re-run gtd, using the ACTUAL precedent phrasing the prompt task
  writes, e.g. `And stdout contains "Re-run gtd — the next cycle commits"`.
  (Do NOT assert "Re-run gtd immediately" — that string is incidental and not the
  precedent phrasing.)
- Replace `And stdout does not contain "Re-run gtd immediately"` with
  `And stdout does not contain "STOP"`.
- Leave the `Given`/`When` setup steps unchanged.

## What to do — `test-gate.feature` — OPTIONAL Pass-2 scenario

Existing scenarios only assert the Pass-1 prompt is produced (no STOP /
auto-advance claim) and STAY VALID as-is. Optionally ADD one scenario proving
Pass 2: after a human-review run leaves the `.gtd-commit-intent` marker +
uncommitted `REVIEW.md`, the FOLLOWING run yields the
`review(gtd): create review for <short>` commit and the `await-review` prompt.
Assert via the last-commit subject and the next prompt. Use existing composable
`Given` steps (see `branches.feature` / `review.steps.ts`) for the
clean-tree-with-prior-review-commit setup; do not add one-off setup steps.
SKIP this if it cannot be expressed cleanly with existing steps — it is optional.

## What to do — `README.md`

- Leaf table, `human-review` row (line 94): the prompt cell currently reads
  "Generate `REVIEW.md` (no test gate — `human-review` settles directly)". Update
  it to the two-pass flow: human-review now AUTO-ADVANCES (writes `REVIEW.md` +
  marker, re-runs gtd) → the edge commits `REVIEW.md` clean → `await-review` is
  the human STOP gate. `human-review` is no longer a terminal settle.
- The `await-review` row (line 83) STAYS as the human STOP gate — do not change.
- Mermaid decision tree (line 259): `HumanReview[human-review: generate REVIEW.md]:::terminal`.
  It is no longer `:::terminal`. Reclass it (the auto-advance producers use the
  dotted edge-commit style — see the `Execute -.->|leave uncommitted …|` edge on
  line 251). Show the auto-advance → edge-commit → `await-review` flow: e.g. a
  dotted edge from `HumanReview` to `Resolve` labeled with the auto-advance +
  edge-commit intent (mirroring the `Execute`/`FixTests` dotted edges on lines
  251 / 261), so the diagram reflects that the next cycle commits `REVIEW.md` and
  lands on `await-review`. Keep the existing
  `HumanReview -.->|"user works REVIEW.md, next /gtd"| ReviewProcess` edge
  (line 262) valid (it now flows from `await-review`'s gate window — adjust its
  source/label only if needed for accuracy).

## Verification

- Verified by `npm run test:e2e` (NOT vitest). The e2e harness (`tests/integration/support/hooks.ts`)
  runs `npm run build` before the suite, so it picks up the sibling Machine +
  prompt changes automatically — no manual bundle rebuild is needed for e2e to
  pass. (The committed `scripts/gtd.js` bundle is refreshed in package 02.)

## Constraints

- Do NOT touch `src/Machine.ts`, `src/Machine.test.ts`, `src/prompts/human-review.md`,
  or `scripts/gtd.js`.
- The asserted re-run phrasing in `auto-advance.feature` MUST match the actual
  string written by the sibling prompt task (task 02 of this package).
- Do NOT touch `edge-loop.feature` — it has no human-review/await-review refs.

## Acceptance criteria

- [ ] `auto-advance.feature`'s human-review scenario asserts `stdout contains` the
      re-run-gtd phrasing and `stdout does not contain "STOP"`.
- [ ] `test-gate.feature`'s existing scenarios are unchanged; an optional Pass-2
      scenario is added only if expressible with existing composable steps.
- [ ] README leaf-table `human-review` row describes the auto-advance → edge-commit
      → `await-review` two-pass flow; `await-review` row unchanged.
- [ ] README mermaid `HumanReview` node is no longer `:::terminal` and shows the
      auto-advance/edge-commit flow toward `await-review`.
- [ ] `npm run test:e2e` is GREEN (after the sibling Machine + prompt tasks land,
      since e2e rebuilds at runtime).
