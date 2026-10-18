# Review: c2000d2

<!-- base: c6c76e3a487bbdeb4cebc1fd2a497a0a3531f85f -->

**`npm test` now prints a failure repeated across release-flag states once.**
Build #372(b). Runner-only change; the shipped health check is untouched. No
`.feature` scenario changed (tooling, unit-tested only). `.gtd/REQUIREMENTS.md`
is deleted as workflow bookkeeping, not project code.

## Capture output while streaming the first state

`spawnTurbo` moves from `spawnSync` with inherited stdio to async `spawn` with
piped stdout/stderr. Every state's output is captured; only a `live` state also
writes it to the terminal. `--continue` now always goes to turbo so one failing
task no longer kills the others and `Failed:` lists every red task.

- [ ] ./scripts/test-states.ts#167-194 — Risk: **live output loses all colour.**
      turbo's stdout is now a pipe, so turbo detects no TTY and emits no ANSI
      codes for itself or its tasks (verified: `turbo run format:check | cat -v`
      has no escapes, the same run under `script` does). The first state "keeps
      streaming live", but monochrome, a regression from the inherited-stdio
      runner. Fix: append `--color` to the argv when
      `live && process.stdout.isTTY`; `failuresOf` already strips ANSI, so
      parsing is unaffected
- [ ] ./scripts/test-states.ts#156-163 — `--continue` inserted before the
      forwarded args; comment states why it is required for `Failed:` parsing
- [ ] ./scripts/test-states.ts#29-38 — `RunResult` and the `live` flag widen the
      `RunTasks` port; it may return sync or async
- [ ] ./scripts/test-states.main.ts#6-11 — entry awaits `runStates` (top-level
      await) and wires `live` plus the `print` sink to stdout

## Parse and condense failures across states

`failuresOf` reads turbo's `Failed:` line, then groups each failed task's
`<task>: `-prefixed lines. A task's identity is its sorted, deduped
`FAIL <name>` lines from the repo reporter, or its raw lines when it names none.
Later failing states are matched task by task against all earlier failing
states: fully covered prints one `same failures as <labels>` line; otherwise
only the uncovered tasks' lines print. A state with no parseable failure prints
in full.

- [ ] ./scripts/test-states.ts#64-99 — parser and helpers; the `<task>: ` prefix
      match is confirmed against real turbo 2.10.9 output **No-name fallback
      never matches across states:** raw lines carry turbo's per-run
      `cache miss, executing <hash>` and vitest timings, so a vitest task that
      fails without `FAIL` lines (unhandled error, crash) always reprints. This
      over-prints, never hides; acceptable, but the test title claiming
      "ignoring ... timing" overstates it
- [ ] ./scripts/test-states.ts#101-132 — `condenseFailure`: seven parameters,
      `i` passed only to bail on the first state; the caller could skip it.
      `Seen` duplicates the inline type at line 142. Nit-level, no behaviour
      impact
- [ ] ./scripts/test-states.ts#134-154 — `runStates` turns async; every state
      still runs, pass/FAIL line and exit status unchanged. Without `condense`
      every state streams live as before; only tests use that path

## Tests

Unit tests in the tooling suite cover the parser, the condensing rules, and
`spawnTurbo` against a shim turbo binary. A contract-style loop runs the same
cases through the real spawn and through an in-memory string.

- [ ] ./tests/tooling/test-states.test.ts#32-43 — stub returns `RunResult` and
      records `live`
- [ ] ./tests/tooling/test-states.test.ts#115-204 — shim helper; new cases pin
      `--continue` in argv, capture of both streams, terminal writes only when
      live, multibyte char split across chunks, and spawn/in-memory parse parity
- [ ] ./tests/tooling/test-states.test.ts#206-265 — existing cases made async;
      new case pins every state live when not condensing
- [ ] ./tests/tooling/test-states.test.ts#267-295 — `failuresOf`: test names per
      task with ANSI stripped, plain-text fallback, empty without `Failed:`
- [ ] ./tests/tooling/test-states.test.ts#297-413 — condensing: identical
      repeats collapse to one line, first state never reprinted, a passing state
      in between, first failing later state printed in full, flag-specific task
      printed alone, differing test names, unparseable output, no-name tasks,
      coverage spread over several earlier states, live only for state 0, exit
      codes

## Docs

- [ ] ./docs/development.md#25-27 — one paragraph tells contributors what a
      multi-state `npm test` failure now prints
