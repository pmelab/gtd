# Add/update feature scenarios for human-review and verified

Update existing scenarios broken by the verify auto-advance change, and add new
scenarios covering base selection and the verified terminal.

DEPENDS ON task 01 (the new Given steps) and on packages 01-03 being functional.

## Files

- `tests/integration/features/branches.feature` (update verify scenario + add
  new scenarios)
- `tests/integration/features/auto-advance.feature` (update the verify scenario)
- Reference (do not break): `tests/integration/features/review.feature`

## 1. Fix auto-advance.feature

The scenario "Verify prompt contains STOP and no auto-advance" is now WRONG —
verify auto-advances on green. Update it so the verify prompt now CONTAINS
"Re-run gtd immediately" (auto-advance) on the happy path. Adjust the STOP
assertion: the happy path no longer says STOP, but the diagnosis section may
still mention stopping on unrecoverable failure — assert against the new wording
introduced in package 03. Keep the scenario meaningful (assert it advances).

## 2. Update branches.feature verify scenario

The existing "Clean tree after a non-TODO commit triggers the verify task" uses
a bare test project (no remote, no default branch, no prior review). With the
new logic, `computeReviewBase` returns none, so the clean tree routes to the
`verified` terminal. Decide the precise expected branch against package 02's
implemented mapping and update the assertion:

- If the bare-project clean-tree path now emits `verified` → assert stdout
  contains the `verified` prompt heading and does NOT contain human-review.
- If package 02 keeps emitting `verify` first when there is pending work, ensure
  this scenario (which has NO un-reviewed base) lands on `verified`. Align the
  assertion with the actual implemented behaviour — run `gtd` against the
  fixture to confirm, then lock the assertion.

## 3. New scenarios (branches.feature)

Add these, using the new Given steps and real content in scenario text:

a) Parent-branch-only base → human-review

- Seed a default branch, branch off it, add un-reviewed commits on HEAD so a
  merge-base strictly behind HEAD exists.
- Assert stdout contains the human-review prompt heading and the
  `### Diff (git diff <base> HEAD)` context block (the refDiff render).

b) Prior-review-only base → human-review

- No resolvable parent branch; seed a prior review commit several commits back,
  then add un-reviewed commits.
- Assert human-review fires and the embedded base corresponds to the review
  commit (assert on the short/full hash visible in the rendered context or the
  diff header).

c) Both present → closer one wins

- Seed BOTH a parent-branch merge-base AND a prior review commit at DIFFERENT
  distances from HEAD. Assert the emitted human-review prompt's base is the
  CLOSER of the two (assert the expected short hash / base appears, and the
  farther candidate's hash does NOT appear as the base).

d) base == HEAD → verified, no review

- A fully-reviewed tree: prior review commit (or parent branch) equals HEAD /
  empty diff. Assert stdout contains the verified prompt and does NOT contain
  the human-review heading, and that no REVIEW.md generation is instructed.

## Constraints

- Use composable Given steps; put real file/commit content in the scenario text
  (AGENTS.md).
- Assert on stable prompt strings (headings, the `git diff <base> HEAD` context
  label) rather than incidental wording.
- Do not modify `review.feature`; verify all its scenarios still pass.

## Acceptance criteria

- [ ] `auto-advance.feature` verify scenario reflects auto-advance (no longer
      asserts STOP-only / no-advance).
- [ ] `branches.feature` verify scenario updated to the new clean-tree terminal.
- [ ] Four new scenarios (a-d) added and passing.
- [ ] Full cucumber suite green, including unchanged `review.feature`.
