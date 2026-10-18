# Review: 01209a7

<!-- base: 57f4725e6212ed0c383fb51e0c49d30357acb9e0 -->

**Follow-up to build #372(b): condensing now matches on failing test names only,
and the repo reporter prints names stable enough to match.** Runner and reporter
change; the shipped workflow is untouched. No `.feature` scenario changed. The
old `.gtd/REVIEW.md` deletion is workflow bookkeeping.

**Verified:** `tests/tooling/test-states.test.ts` 40/40 green. Turbo 2.10.9
accepts `--continue=dependencies-successful`. Vitest 3.2's `TestModule` has
`errors()`, so the reporter's new call is real API.

**No concrete defect found.** Trade-off kept on purpose: **a task with no `FAIL`
names (typecheck, lint, build, cucumber e2e) reprints in every failing state** —
over-prints, never hides.

## Identity of a failure: test names only

`failuresOf` drops the raw-line fallback. A task's identity is its sorted,
deduped unindented `FAIL <name>` lines; a task without names maps to `[]`, and
`sameTests` refuses to call an empty list a match. Raw lines carried turbo's
per-state cache hash, so the old fallback could never match anyway.

- [ ] ./scripts/test-states.ts#67-96 — parser keeps names in a `Set`, sorts
      them; `FAIL` must now start the line (after the `<task>: ` prefix), so an
      indented message line starting `FAIL` no longer counts. `sameTests` adds
      `b.length > 0`

## Condensing and runner wiring

The previous review's nits are done: `i` is gone (`runStates` skips the call for
state 0), `Seen` is one named type, `condenseFailure` takes one options object.
`print` is now required, so `runStates` always condenses; the "every state live"
path existed only for tests and is gone. The summary line reads
`failures already seen in <labels>`, which fits the new subset matching.

- [ ] ./scripts/test-states.ts#98-134 — options-object `condenseFailure`; a
      novel task with no `<task>: ` prefixed lines (e.g. `--log-prefix=none`)
      falls back to the full output instead of printing an empty line
- [ ] ./scripts/test-states.ts#136-156 — `runStates` streams only state 0 live,
      condenses every later failing state
- [ ] ./scripts/test-states.main.ts#4-16 — one `io` object (stdout, stderr, TTY)
      feeds both `spawnTurbo` and the condensed print

## Spawning turbo

`--continue` becomes `--continue=dependencies-successful`: a bare `--continue`
means `always`, which ran e2e against a stale `dist/` after a failed `build`.
Output capture now goes through an injected `Io` port instead of
`process.stdout`/`console.error`, and joins the two streams at line boundaries.

- [ ] ./scripts/test-states.ts#158-173 — continue mode and its reason in the
      comment
- [ ] ./scripts/test-states.ts#175-199 — `Io` port; `wholeLines` buffers each
      stream to the last newline so a stderr line never splits a stdout `FAIL`
      name in the captured output
- [ ] ./scripts/test-states.ts#201-240 — `args`/`live` lose their defaults; live
      chunks still go straight to the sinks, capture goes through `wholeLines`,
      both buffers flush on `close`; spawn errors go to `io.err`

## Reporter prints matchable names

`tests/vitest.reporter.ts` is the format `failuresOf` reads. Names now carry the
file, so two files with the same `describe > it` stay distinct. Collection
errors (a file that fails to import) and unhandled errors used to make vitest
red with no `FAIL` line at all; each now gets one.

- [ ] ./tests/vitest.reporter.ts#1-9 — comment pins the contract with the
      runner; `indent` indents every line of a multi-line message
- [ ] ./tests/vitest.reporter.ts#20-55 — `FAIL <file> > <fullName>`; module
      `errors()` print as `FAIL <file>`, unhandled ones as
      `FAIL unhandled error: <first message line>`; the count includes both.
      FYI: an unhandled error whose first line differs per state (a path, a
      timing) never matches and reprints — over-prints, not a defect

## Tests

- [ ] ./tests/tooling/test-states.test.ts#117-146 — `recorder` fake for the `Io`
      port replaces `process.stdout`/`isTTY` monkeypatching; spawn-failure case
      now asserts the err sink
- [ ] ./tests/tooling/test-states.test.ts#148-205 — shim cases use the port;
      new: stderr line between two halves of a stdout `FAIL` line still parses,
      trailing unterminated line kept. The old spawn/in-memory parity loop is
      removed; the splice case covers the spawn side
- [ ] ./tests/tooling/test-states.test.ts#207-305 — `turboArgv` pins
      `dependencies-successful`; `runStates` cases pass a `print` sink and pin
      live only for state 0
- [ ] ./tests/tooling/test-states.test.ts#307-383 — `turboOut` adds a per-run
      cache-hash line to every task, as real turbo does; new case drives the
      real `SilentReporter` and parses its output: indented `FAIL` message lines
      ignored, file-qualified names, module and unhandled errors named
- [ ] ./tests/tooling/test-states.test.ts#385-530 — condensing uses real
      `planStates` labels; new: subset of earlier failing tasks counts as seen,
      two no-name failures never match, novel failure without prefixed lines
      prints in full; spread-over-states case now uses two vitest tasks
