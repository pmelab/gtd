# 01 — PR #393 review fixes to the test-states runner

See `.gtd/ARCHITECTURE.md` for interfaces and call stacks.

## Requirements

1. **Always pass `--log-prefix=task`.** Turbo's default `auto` drops the
   `<task>: ` prefix in GitHub Actions, so every `failureSignature` is empty in
   CI and repeated failures never collapse. A user `--log-prefix` (either
   spelling) replaces the default; collapsing turns off unless it is `task`.
   Passing states still print only their label.
2. **Only `--output-logs full` turns on full mode** (either spelling). Any other
   user value still replaces the default in argv, but collapsing stays on and
   passes print only their label. One exported `flagValue` helper answers both
   "passed?" and "which value?"; the entry point's duplicated predicate goes.
3. **`failureSignature` replaces only whole-word 16-char hex runs**
   (case-insensitive). 12-char and 40-char git shas stay — otherwise distinct
   failures collapse.
4. **Real-turbo test resolves turbo from `import.meta.url`**, never `cwd`, and
   builds argv with `turboArgv`.

## Tasks

### 1. `flagValue` helper

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

- [ ] `flagValue(args, flag)` exported; returns value for `--flag=x` and
      `--flag x`, `""` when the flag ends args, `undefined` when absent
- [ ] Tests: `--output-logs=full`, `--output-logs full`, `=new-only`, `new-only`
      separate, no flag, `--log-prefix=none` / `--log-prefix none`

### 2. `turboArgv` appends `--log-prefix=task`

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

- [ ] `turboArgv` appends `--output-logs=errors-only` and `--log-prefix=task`,
      each only when `flagValue` finds no user value
- [ ] Tests: no user flags → argv ends with both defaults; user
      `--log-prefix=none` and `--log-prefix none` replace the default
      (`--log-prefix=task` appears nowhere); user `--output-logs=new-only` and
      `--output-logs new-only` replace the output default and keep
      `--log-prefix=task`
- [ ] Shim-turbo argv case expects `--log-prefix=task` after
      `--output-logs=errors-only`

### 3. `runStates` options object

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

- [ ] `runStates(states, run, log, options?: RunOptions)` replaces the bare
      `full` boolean; `collapse` defaults true, ignored when `full`
- [ ] `reportFailure` calls `failureSignature` only when `collapse && !full`
- [ ] Test `{ collapse: false }`: two identical failures both print in full, no
      "same failure as" line, a passing state prints only its label
- [ ] Existing full-mode case migrated to `{ full: true }`; default-options
      cases unchanged and green

### 4. Entry point derives options from `flagValue`

Paths: `scripts/test-states.main.ts`, `tests/tooling/test-states.test.ts`

- [ ] `full: flagValue(args, "--output-logs") === "full"`,
      `collapse: (flagValue(args, "--log-prefix") ?? "task") === "task"`
- [ ] Duplicated `--output-logs` predicate deleted
- [ ] Tests over the same expressions: `--log-prefix=task` → collapse on;
      `--log-prefix=none` → collapse off; `--output-logs=new-only` → full off,
      collapse on; `--output-logs full` → full on

### 5. Narrow hex normalisation

Paths: `scripts/test-states.ts`, `tests/tooling/test-states.test.ts`

- [ ] `failureSignature` replaces only `\b[0-9a-f]{16}\b` (case-insensitive)
- [ ] Tests: outputs differing only in a 16-char hash share a signature; only in
      a 40-char sha differ; only in a 12-char abbreviated sha differ

### 6. Real-turbo test off `import.meta.url`

Paths: `tests/tooling/test-states.test.ts`

- [ ] Turbo path is
      `fileURLToPath(new URL("../../node_modules/.bin/turbo", import.meta.url))`
- [ ] Argv from `turboArgv(["boom"], [])`; env includes `GITHUB_ACTIONS: "true"`
- [ ] Signature non-empty, contains `boom-line`, stable across two runs; passes
      when vitest runs from a non-root cwd

### 7. Docs

Paths: `docs/development.md`

- [ ] States `--log-prefix=task` is always passed; a user `--log-prefix`
      replaces it and turns collapsing off unless `task`
- [ ] Keeps "`--output-logs=full` never collapses" without implying other values
      do

### 8. PR #393 description

Paths: none (`gh pr edit 393 --body …`)

- [ ] "Decisions" bullet rewritten: a user `--output-logs` replaces the default;
      only `full` prints passes and turns collapsing off; `--log-prefix` rule
      added

### 9. Full suite green

- [ ] `npm test` passes

## Tests

- unit: `tests/tooling/test-states.test.ts`
