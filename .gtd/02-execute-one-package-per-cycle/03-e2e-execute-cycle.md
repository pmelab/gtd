# Task: Cucumber coverage for the execute one-package-per-cycle test gate

Author e2e scenarios proving the `execute` leaf runs the test gate and branches.
This task touches ONLY `tests/integration/` files, so it runs in parallel with
tasks 01-02. Scenarios run against the rebuilt `scripts/gtd.js` (the package
orchestrator rebuilds the bundle after all parallel tasks land — see
COMMIT_MSG.md).

## Files

- `tests/integration/features/execute-gate.feature` (NEW).
- Reuse existing composable Given steps (`a file ... with:`, `a commit ... that
  adds ... with:`, `a directory ...`, `a fix(gtd) commit ...`) and the
  package.json test-script setup introduced in package 01. Add a new generic
  Given step ONLY if none compose cleanly, and keep it generic.

## How to reach the `execute` leaf

The machine resolves to `execute` when `.gtd/` contains a numbered package dir
with task files AND the tree is otherwise clean (no code/review dirt). Build a
fixture with a committed `package.json` (controllable `test` script) plus a
committed `.gtd/01-foo/` package (a task `.md` + `COMMIT_MSG.md`). Model the
`.gtd/` setup on how decompose/execute are exercised elsewhere; commit the
`.gtd/` contents so the tree is clean.

## Scenarios

1. **execute green → next-package execute prompt**: committed `package.json`
   test script `exit 0`, a committed `.gtd/01-foo/` package. Run gtd. Assert
   stdout contains the one-package execute instruction (e.g. the new
   "exactly one" / lowest-numbered package wording) and does NOT contain the
   `fix-tests` block.
2. **execute red → fix-tests prompt**: same `.gtd/01-foo/` package but
   `package.json` test script `echo EXEC_SENTINEL; exit 1`. Run gtd. Assert
   stdout contains the `fix(gtd):` one-fix instruction AND `EXEC_SENTINEL`, and
   does NOT contain the execute one-package instruction.
3. **execute red at cap → escalate**: a `.gtd/01-foo/` package, red
   `package.json`, and 5 trailing `fix(gtd):` commits (reuse `a fix(gtd) commit`)
   so `verifyIterations` reaches the cap. Run gtd. Assert stdout contains
   `Escalate to the human` (NOT fix-tests, NOT the execute prompt) — proving the
   edge cap overrides the machine's hasPackages-before-capReached order.

## Acceptance criteria

- [ ] `execute-gate.feature` exists with the three scenarios, using composable/
      existing Given steps and exposing the `package.json` test-script content
      in the scenario text.
- [ ] After the bundle rebuild, `npm run test:e2e` passes including these
      scenarios.

## Constraints / edge cases

- The tree must be CLEAN for `execute` to win (no uncommitted code), so commit
  `package.json` and the `.gtd/` package contents.
- The cap scenario must keep the `.gtd/` package present so the leaf is
  `execute` (hasPackages), demonstrating the edge cap fires despite the machine
  ordering.
