# Integration scenario: empty red gate routes to Fixing, not Close package

Add a cucumber scenario in `tests/integration/features/testing.feature` that is
the exact repro from issue #8: a test command that exits non-zero but prints
nothing must route to Fixing (writing a non-empty FEEDBACK.md), never to Close
package.

Depends on Package 01 (the fix). On the pre-fix code this scenario fails — the
empty FEEDBACK.md is read as agentic-review approval and the run closes the
package (`gtd: package done`) instead of fixing.

## Context

The existing red-below-cap scenario is at
`tests/integration/features/testing.feature:34-64` ("A red gate below the cap
writes FEEDBACK.md and routes to Fixing"). It already uses the composable Given
steps you need:

- `Given a test project`
- `And a commit "<subject>" that adds "<path>" with:` (heredoc body)
- `And a gtd config file at ".gtdrc" with:` (heredoc)
- `And a file "<path>" with:` (heredoc — pending, uncommitted)
- `When I run gtd`
- `Then it succeeds`
- `And the git log contains "<subject>"`
- `And the last commit subject is "<subject>"`
- `And the file "<path>" does not exist`
- `And stdout contains "<text>"`
- `And stdout does not contain "<text>"`

No new step definitions are required — reuse these.

## What to implement

Add a scenario, e.g. titled **"A red gate with no output still routes to Fixing,
not Close package"**, modeled on the lines 34-64 scenario but with a gate that
emits **no output**:

- `gate.sh` body is just `exit 1` (no `echo`).
- config: `testCommand: bash gate.sh`.
- a `gtd: planning` commit that adds a `.gtd/01-foo/01-task.md` package.
- a pending `src/helper.ts` (gives Testing a reason to test).

Assertions (the issue contract):

- `Then it succeeds`
- `And the git log contains "gtd: errors"`
- `And the last commit subject is "gtd: fixing"`
- `And stdout contains "## Task: Fix the package against \`FEEDBACK.md\`"`
- `And stdout does not contain "## Task: Close"`
- `And stdout does not contain "gtd: package done"`

(FEEDBACK.md is written non-empty as `gtd: errors`, then Fixing consumes it and
commits its removal as `gtd: fixing` — same lifecycle as the existing
red-below-cap scenario, so `And the file "FEEDBACK.md" does not exist` also
holds at the end if you want to assert it.)

## Files to examine

- `tests/integration/features/testing.feature` — existing red-below-cap scenario
  (34-64) to mirror; green scenario (9-32) for the Close/Agentic-review stdout
  strings to negate.
- Step definitions under `tests/integration/support/` and
  `tests/integration/helpers/` if you need to confirm a step's exact phrasing
  (do NOT add new steps unless an existing one truly does not cover the need).

## Acceptance criteria

- [ ] New scenario added to `testing.feature` with a `gate.sh` whose body is
      `exit 1` and no echo.
- [ ] Scenario asserts `git log contains "gtd: errors"` and last commit subject
      is `gtd: fixing`.
- [ ] Scenario asserts stdout contains the Fixing task header
      (`## Task: Fix the package against \`FEEDBACK.md\``).
- [ ] Scenario asserts stdout does NOT contain a Close-package task header nor
      `gtd: package done`.
- [ ] Only existing composable Given/When/Then steps are reused — no new one-off
      step definitions.
- [ ] `npm run test:e2e` passes (all cucumber scenarios green).
