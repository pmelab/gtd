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

## test-audit: "entry point option expressions" is a copied implementation

This adds weight to the first correctness chunk. The `describe` block rebuilds
`{ full, collapse }` inside the test and asserts on that rebuilt copy, so it
tests itself. That makes it junk whether or not `runOptions` gets extracted:
delete it. A `runOptions(args)` test that replaces it should cover the cases
that actually guard the change. Bare `[]` must give `collapse: true`, which is
the `?? "task"` default that every plain `npm test` relies on. `--log-prefix`
should be tested in both spellings, `--log-prefix=none` and `--log-prefix none`.
`--output-logs=new-only` must give `full: false`. Use one `it.each` table, not
four separate `it`s.

## test-audit (consider): duplicate `flagValue` / `turboArgv` cases

`flagValue` works the same way for any flag name. "reads =new-only", "reads
separate new-only" and "reads --log-prefix in both spellings" repeat the
`--flag=x` / `--flag x` contract with different strings, and none of them fails
in a way the first two cases would not. Fold them all into one `it.each` table.
In `turboArgv`, the "new-only" case checks the same presence-based rule as the
`full` cases. Its `not.toContain` checks are also weaker than the exact
`toEqual` the other cases use, since an extra or reordered default would get
past them. Use exact argv in one table. The `--` boundary case from the second
correctness chunk belongs in the same table.

Kept as real proof, no action needed:

- The real-turbo test with `GITHUB_ACTIONS=true` now goes through `turboArgv`. I
  checked it by hand: without `--log-prefix=task`, turbo prints `boom-line` with
  no prefix, so the signature is empty and the test fails.
- The "collapse off" `runStates` case fails if `collapse` is ignored.
- The 12-char sha "differs" case is the only one that guards the hex-regex
  narrowing. The 16-char "equal" case also passes on the old regex.
