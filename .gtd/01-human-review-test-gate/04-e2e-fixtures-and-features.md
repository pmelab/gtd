# Task: Cucumber Given steps for package.json + human-review test-gate features

Author the e2e coverage for the human-review test gate. This task touches ONLY
test files (`tests/integration/`), so it is independent of the src tasks 01-03
and runs in parallel with them. The feature scenarios are run against the
rebuilt `scripts/gtd.js` (the package orchestrator rebuilds the bundle after all
parallel tasks land — see COMMIT_MSG.md).

## Files

- `tests/integration/support/steps/common.steps.ts` — add composable Given
  step(s) that write a `package.json` with a controllable `test` script.
- `tests/integration/features/test-gate.feature` (NEW) — human-review
  green/red/cap scenarios.

## Composable Given steps to add (generic, content-exposing, one step → one effect)

Per AGENTS.md: keep Given steps small, reusable, generic, and expose the actual
file content in the scenario text — do not hide setup behind abstract names.

Add a step that writes a `package.json` whose `test` script is given verbatim in
the scenario, e.g.:

```gherkin
Given a file "package.json" with:
  """
  { "scripts": { "test": "exit 1" } }
  """
```

The EXISTING `Given a file {string} with:` step already writes arbitrary file
content — PREFER reusing it (write `package.json` via that step) rather than
adding a one-off step. Only add a new step if a committed `package.json` is
needed (the test gate runs on a clean tree for human-review, so `package.json`
must be COMMITTED, not just present). In that case reuse the existing
`Given a commit {string} that adds {string} with:` step to commit it. Add a NEW
step only if neither composes cleanly; if you do, keep it generic (e.g. write +
commit a package.json with a given test-script command).

## Feature scenarios (`test-gate.feature`)

Build fixture repos that resolve to `human-review` (clean tree + a review base
with a non-empty `base..HEAD` diff — model on `tests/integration/features/
review.feature` for how to reach human-review) AND contain a committed
`package.json` with a `test` script.

1. **human-review green → REVIEW.md prompt**: `package.json` test script
   `exit 0`. Run gtd. Assert stdout contains the REVIEW.md-generation
   instruction (e.g. `format REVIEW.md`) and does NOT contain the fix-tests
   `fix(gtd):` test-failure block.
2. **human-review red → fix-tests prompt**: `package.json` test script
   `exit 1` (optionally `echo SENTINEL_FAILURE; exit 1`). Run gtd. Assert stdout
   contains the `fix(gtd):` one-fix-then-commit instruction AND the captured
   output (`SENTINEL_FAILURE`) AND does NOT contain `format REVIEW.md`.
3. **human-review red at cap → escalate**: build a fixture with 5 trailing
   `fix(gtd):` commits (reuse `Given a fix(gtd) commit {string}`) on top of a
   human-review-eligible state with a red `package.json`. Run gtd. Assert stdout
   contains `Escalate to the human` and does NOT contain the fix-tests block.

## Acceptance criteria

- [ ] `test-gate.feature` exists with the three scenarios above, using
      composable/existing Given steps and exposing the `package.json` test-script
      content in the scenario text.
- [ ] Any new Given step added is generic and reused-friendly (not a one-off
      tied to this feature).
- [ ] After the bundle is rebuilt, `npm run test:e2e` passes including these
      scenarios.

## Constraints / edge cases

- The fixture `package.json` `test` script must exit deterministically (0 or
  non-zero) on demand — that is the entire mechanism for driving green/red.
- For human-review the tree must be CLEAN, so `package.json` must be committed
  (not left dirty), otherwise the leaf resolves to `code-changes` instead.
