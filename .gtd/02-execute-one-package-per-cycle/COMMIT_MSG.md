feat(gtd): gate the execute path on npm run test, one package per cycle

Apply the deterministic test gate to the `execute` leaf and restructure the
execute prompt so each gtd run handles exactly one work package.

The edge now runs the hardcoded `npm run test` when resolve() lands on
`execute`, reusing the TestRunner service and the fix-tests/cap selection from
the human-review gate:

- green -> emit the execute prompt for the next (lowest-numbered) package;
- red -> the `fix-tests` prompt with captured output (a prior package broke the
  tests);
- red at the escalation cap (trailing `fix(gtd):` >= 5) -> escalate. The cap is
  enforced in the edge because the machine checks hasPackages before capReached,
  so a failing-test package would otherwise loop forever. Machine guard order is
  unchanged.

execute.md is rewritten to one-package-per-cycle: spawn parallel workers for the
single lowest-numbered package, commit with its COMMIT_MSG.md, delete the
package dir, then re-run gtd. The in-prompt "testing subagent" step is removed
— verification happens at the start of the following cycle via the edge, which
verifies the package just committed on a clean tree. Adds vitest coverage for
the execute-leaf selection and cucumber scenarios for green/red/cap. Rebuilds
scripts/gtd.js.

After the parallel task workers land, the orchestrator runs `npm run build` to
regenerate scripts/gtd.js, then `npm test` and `npm run test:e2e` to confirm
the package is green before committing.
