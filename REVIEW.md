# Review: 2e9a814

<!-- base: 2e9a81431aca4cb368c5b73e5f82d1ef87df14a8 -->

13 bug fixes across 4 areas: config schema/loading, the `format` command, git
porcelain + code-fence parsing, and machine resolve/idempotency. Each chunk
below groups the related production changes; the feature/step files that cover
them are listed last.

## Config schema: integer bounds for numeric options (#14)

`fixAttemptCap` and `reviewThreshold` were plain `Schema.Number`, so floats and
out-of-range values passed validation. Now both are `Schema.Int` with bounds
(`>= 0` and `>= 1` respectively).

- [ ] ./src/Config.ts#71
- [ ] ./src/Config.ts#72

## Config loading: non-object configs, filepath in errors, stderr routing (#16, #17, #21)

The YAML/JSON loaders previously ignored their filepath and let `null`/array
configs through. Now each loader wraps parsing in try/catch and prefixes the
offending filepath, rejects `null`, and `loadMerged` rejects non-plain-object
configs naming the file and its actual kind. `loadMerged` switched from
`Effect.promise` (which dies as a defect on stdout) to `Effect.tryPromise` with
a typed `Error` catch, so parse failures route to stderr with exit 1.

- [ ] ./src/Config.ts#137
- [ ] ./src/Config.ts#150
- [ ] ./src/Config.ts#170
- [ ] ./src/Config.ts#194
- [ ] ./src/Config.ts#205

## Config schema: concise validation errors (#23)

Schema decode errors used `String(e.message ?? e)`, dumping a ~600-char Struct
description. New `formatSchemaError` uses `ArrayFormatter` to emit a concise
`path: message; ...` summary.

- [ ] ./src/Config.ts#6
- [ ] ./src/Config.ts#229
- [ ] ./src/Config.ts#245

## format command: fail loudly on bad input (#18, #19, #20)

`formatFile` previously swallowed all errors into a stderr warning and returned
`void` (exit 0). It now (a) rejects non-markdown extensions before touching the
file (was silently corrupting them via prettier), (b) fails instead of warning
on missing files, and (c) propagates a typed `Error` so the CLI exits 1.
`main.ts` now validates arg count: missing path and extra args both fail (extras
were previously ignored).

- [ ] ./src/Format.ts#12
- [ ] ./src/Format.ts#22
- [ ] ./src/Format.ts#33
- [ ] ./src/Format.ts#42
- [ ] ./src/main.ts#42
- [ ] ./src/main.ts#46

## Git porcelain: decode C-quoted paths (#11)

When `core.quotepath` is on (default), git wraps paths with unicode/spaces in
`"..."` with backslash escapes. The new `unquoteGitPath` decodes them, buffering
octal byte escapes for correct multi-byte UTF-8 reconstruction, and is applied
in `parsePorcelainPaths`.

- [ ] ./src/Events.ts#65
- [ ] ./src/Events.ts#134

## Code fence: don't trip on unclosed fences (#12)

`stripCode`'s regex required a closing fence, so markers inside an unclosed code
fence leaked through and falsely tripped the grilling STOP. The pattern now also
matches a fence that runs to end-of-input (`(?:\n\1[^\n]*|$)`).

- [ ] ./src/Events.ts#145

## Machine: idempotent grilling STOP (#13)

Re-running at the grilling STOP gate emitted an empty `gtd: grilling` commit
each time. Now, when the tree is clean and HEAD is already `gtd: grilling`, the
`commitPending` edgeAction is omitted, making the re-run a no-op.

- [ ] ./src/Machine.ts#503
- [ ] ./src/Machine.ts#507

## Machine: cap=0 human-resume escalates immediately (#15)

`capReached` was computed as `resume ? false : ...`, so a human resume with
`fixAttemptCap = 0` was granted one FEEDBACK cycle before escalating. The guard
now compares the resolved error count (`resume ? 0 : testFixCount`) against the
cap, so cap=0 escalates on the first pass.

- [ ] ./src/Machine.ts#406

## TestRunner: clean stderr error for missing test binary (#22)

`run` used `Effect.orDie`, so a missing `testCommand` binary surfaced as a raw
defect on stdout. The Effect is now typed `Error`; a `catchAll` distinguishes
spawn ENOENT/NotFound (`test command not found: ...`) from other start failures
and fails with a typed `Error` so `main.ts` reports it on stderr with exit 1.

- [ ] ./src/TestRunner.ts#17
- [ ] ./src/TestRunner.ts#64
- [ ] ./src/TestRunner.ts#71

## Tests & docs

Cucumber coverage for each fix plus reusable steps/world helpers, and README
updates documenting the new validation/format behavior.

- [ ] ./tests/integration/features/config.feature
- [ ] ./tests/integration/features/formatting.feature
- [ ] ./tests/integration/features/grilling.feature
- [ ] ./tests/integration/features/fixing.feature
- [ ] ./tests/integration/features/testing.feature
- [ ] ./tests/integration/support/steps/common.steps.ts
- [ ] ./tests/integration/support/world.ts
- [ ] ./src/TestRunner.test.ts
- [ ] ./README.md
