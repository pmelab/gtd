feat(gtd): run npm run test in the human-review edge, branch to fix-tests

Move test execution out of the human-review agent prompt and into the Effect
edge so the pass/fail signal is deterministic. A new TestRunner service
(Context.Tag + Live layer, mirroring GitService) runs the hardcoded `npm run
test`, capturing combined output and the exit code. When resolve() lands on
`human-review` the edge runs the tests and selects the prompt:

- green (exit 0) -> the existing REVIEW.md-generation prompt, unchanged;
- red (exit != 0) -> a new `fix-tests` prompt embedding the captured failure
  output and instructing one `fix(gtd):` commit then a re-run;
- red at the escalation cap (trailing `fix(gtd):` count >= 5) -> the escalate
  prompt instead.

`fix-tests` is a prompt-selection decision keyed off (leafState, testExitCode)
in the edge, not a new machine state; src/Machine.ts stays pure/IO-free. The
old "Test gate (run first)" agent instructions are removed from
human-review.md. Adds vitest coverage for the service and prompt selection, and
cucumber scenarios driving green/red/cap via a committed package.json test
script. Rebuilds scripts/gtd.js.

After the parallel task workers land, the orchestrator runs `npm run build` to
regenerate the checked-in scripts/gtd.js bundle, then `npm test` and
`npm run test:e2e` to confirm the package is green before committing.
