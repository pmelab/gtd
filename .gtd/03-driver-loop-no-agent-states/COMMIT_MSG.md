refactor(gtd): drive no-agent + side-effect actions from main.ts loop

Replace the hard-coded `review-process` if-block and the `TEST_GATED_LEAVES` set
with a pure driver loop that switches on the machine-emitted `EdgeAction`,
executes it via GitService/TestRunner, re-feeds events, and emits exactly one
prompt. `human-review` no longer spawns the test runner. Retire the now-dead
`cleanup`/`close-review`/`code-changes` prompts and their Prompt.ts wiring; move
the test-gate render coverage into Prompt.test.ts so vitest stays green. No
status output — the only stdout is the final prompt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
