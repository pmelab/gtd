## correctness: entry-point test checks a copy, not `test-states.main.ts`

`tests/tooling/test-states.test.ts` "entry point option expressions" redefines
the `{ full, collapse }` expressions inline and asserts on that copy. Nothing
imports or runs `scripts/test-states.main.ts`. So if main went back to
`args.some(...)` for `full`, or dropped the `?? "task"` default (which would
turn collapsing off on every bare `npm test`), all four cases would still pass.
Those are the two behaviours the docs promise, and they have no real test.

Fix: move the expressions into an exported `runOptions(args): RunOptions` in
`scripts/test-states.ts`, call it from main, and test that function. Then delete
the inline copy.

## correctness (consider): defaults land after a user's `--`

`turboArgv` emits `run <tasks> ...args <defaults>`. If the forwarded args
contain `--` (turbo's pass-through to tasks, e.g. `npm test -- -- --bail=1`),
then `--output-logs=errors-only` and the new `--log-prefix=task` come after it.
Turbo hands them to vitest/oxlint/etc. instead of using them itself. Turbo then
runs with its own defaults (full logs, `auto` prefix), so on GitHub Actions
`failureSignature` finds no prefixed lines and collapsing quietly stops working.
`flagValue` also scans past `--`, so a task-level flag spelled
`--log-prefix`/`--output-logs` would suppress the turbo default.

This was already true for `--output-logs`; this change adds a second flag to it.
The line-164 comment ("args must be turbo options") arguably puts `--` out of
contract, so this isn't blocking. The cheap fix is to put the defaults before
`...args` and stop `flagValue` at `--`, with one `turboArgv` case using
`["--", "x"]`.
