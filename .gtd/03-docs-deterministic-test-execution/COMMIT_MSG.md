docs(gtd): document deterministic test execution and one-package execute

Update README.md and SKILL.md to describe the behavior added in the preceding
packages:

- gtd now runs the hardcoded `npm run test` in the Effect edge for the
  `human-review` and `execute` states (not the agent), capturing output and the
  exit code and branching the emitted prompt on the result;
- a new `fix-tests` PROMPT (edge-selected, not a machine leaf state) is emitted
  on a red test run, instructing one `fix(gtd):` commit then a re-run;
- the trailing `fix(gtd):` escalation cap (5 -> escalate) is enforced in the
  edge so it works uniformly for both gated paths;
- execute is now one package per cycle: each run executes the lowest-numbered
  package and the next cycle's edge verifies it, replacing the old in-prompt
  testing subagent.

Updates the states tables, the test-fix iteration notes, the execute
walkthrough, and the mermaid diagram.

Docs-only change; no src/ changes, so no rebuild is required. The orchestrator
runs `npm run format:check` (or `prettier --check`) over the edited markdown
before committing.
