# Review: 59b9925

<!-- base: e4c1262469fbfa68226cd0990af1b42a0639580e -->

No `.feature` scenario changed; all coverage is vitest in `tests/tooling/`.

## Turbo flag parsing and defaults

**One `flagValue` parser now reads both `--output-logs` and `--log-prefix`, and
stops at `--`.** `turboArgv` adds each default only when the user gave none, and
puts defaults before user args so a `--` cannot hand them to the tasks.

- [ ] ./scripts/test-states.ts#143-153 — `flagValue`: `--flag=x`, `--flag x`,
      `""` for a trailing bare flag, `undefined` when absent or after `--`
- [ ] ./scripts/test-states.ts#155-164 — `turboArgv` now always adds
      `--log-prefix=task`, because turbo's `auto` drops the `<task>: ` prefix in
      GitHub Actions and `failureSignature` needs it **Order changed: defaults
      now precede user args** (was: appended last).
- [ ] ./tests/tooling/test-states.test.ts#170-180 — table tests for `flagValue`,
      including the `--` stop
- [ ] ./tests/tooling/test-states.test.ts#196-207 — `turboArgv` table: user
      value replaces each default; `--` keeps defaults on turbo's side
- [ ] ./tests/tooling/test-states.test.ts#141-147 — shim-turbo argv expectation
      updated to the new order

## When failures collapse

**Collapsing is now a separate `collapse` option, not tied to `full`.**
`runOptions` turns it off for a non-`task` log prefix and for
`hash-only`/`none`, which print no failure log and would merge distinct
failures. **Behaviour change: `--output-logs=new-only` (any value but `full`)
used to set `full`; now only `full` does.**

- [ ] ./scripts/test-states.ts#109-122 — `RunOptions { full, collapse }`
      replaces the `full` boolean; defaults `full=false`, `collapse=true`
- [ ] ./scripts/test-states.ts#93-99 — `reportFailure` computes a signature only
      when `collapse && !full`
- [ ] ./scripts/test-states.ts#138-138 — passes the options object through
- [ ] ./scripts/test-states.ts#165-177 — `runOptions(args)`: allowlist
      `undefined`/`errors-only`/`new-only` collapse; an empty `--output-logs`
      value also disables collapse
- [ ] ./scripts/test-states.main.ts#2-10 — entry point uses `runOptions(args)`
      instead of its inline `--output-logs` check
- [ ] ./tests/tooling/test-states.test.ts#183-194 — `runOptions` table over
      every `--output-logs` value and `--log-prefix` form
- [ ] ./tests/tooling/test-states.test.ts#350-373 — `full` call updated; new
      case: `collapse: false` prints both identical failures in full and passes
      as a label only

## Hash normalisation narrowed

**`failureSignature` now masks only exactly-16-char hex (turbo task hashes), no
longer any 12+ run.** So git shas (12 or 40 chars) stay in the signature and two
failures differing only by sha no longer collapse.

- [ ] ./scripts/test-states.ts#75-75 — regex `{12,}` → `{16}`; a 17+-char hex
      token is now left unmasked
- [ ] ./tests/tooling/test-states.test.ts#254-271 — pins: 16-char hashes (any
      case) equal; 40- and 12-char shas differ

## Real-turbo signature test

**The real-turbo test now builds argv via `turboArgv` and sets
`GITHUB_ACTIONS=true`, so it exercises the CI prefix path the `--log-prefix` fix
targets.**

- [ ] ./tests/tooling/test-states.test.ts#229-234 — turbo path resolved from
      `import.meta.url`, not `process.cwd()`
- [ ] ./tests/tooling/test-states.test.ts#5-13 — new imports (`fileURLToPath`,
      `flagValue`, `runOptions`)

## Docs

- [ ] ./docs/development.md#27-32 — documents forced `--log-prefix=task`, and
      which `--output-logs` values keep or disable collapsing
