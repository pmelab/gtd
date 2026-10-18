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

## conventions (consider): `RunOptions.collapse` JSDoc only restates the code

AGENTS.md, Comments: "Keep a comment … only where it explains an important
decision or genuinely unclear code … Everything else (restatement of the code …)
gets deleted, not moved."

In `scripts/test-states.ts`, `/** Collapse repeated failures (default true). */`
on `RunOptions.collapse` says the field name again, and the default is right
there in `runStates` (`options.collapse ?? true`). Delete it. The JSDoc on
`full` can stay, because "never collapses" records the precedence over
`collapse`, which isn't obvious from the field name. The `flagValue` JSDoc (""
vs undefined) and the GitHub Actions `auto` comment in `turboArgv` explain a
real why, so keep both.

No other rule is broken. `docs/development.md` names only flags and npm scripts,
no `src/*.ts` module or internal function. Code comments are allowed to name
`failureSignature`.

## spec-challenge: `--output-logs=hash-only` keeps collapsing on, so different failures get merged

The spec decision in REQUIREMENTS §2 / ARCHITECTURE: "Any other user value
(`errors-only`, `new-only`, `hash-only`, `none`) … collapsing stays on". It
names `hash-only` on purpose. This clashes with a rule `scripts/test-states.ts`
already states (the comment above `failureSignature`, and §3 of the same spec):
normalisation errs toward "distinct". A signature must never merge two different
failures.

Under `hash-only`, turbo prints none of a failing task's output. It prints only
`<task>: cache bypass, force executing <16-hex>` (or
`cache miss, executing <16-hex>`). I checked against real turbo with two scratch
tasks that echo different text and both fail. Both gave the same prefixed line,
apart from a 16-char hash that `failureSignature` turns into `<hex>`. Every flag
state runs the same tasks, so every failing state after the first prints
`FAIL (same failure as defaults)` and no log, whatever actually broke. Under
`none` there are no prefixed lines, so the signature is `""` and nothing
collapses. That case is safe, which shows the merging comes only from
`hash-only`.

Fix: decide collapse from whether the output carries failure logs, not only from
whether the value is `full`. Turn collapsing off for `hash-only` (and `none`, to
keep it symmetric). One way is to make `collapse` require `--output-logs` ∈
{absent, `errors-only`, `new-only`}. Add a `runOptions` case for it. Then
`docs/development.md`'s new "any other `--output-logs` value replaces the
default but still collapses" is wrong for `hash-only`, and the PR #393
"Decisions" bullet repeats the same claim. Both need correcting.
