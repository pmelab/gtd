# Package 3 — Warn on a missing `C` row

`validateDefinition` has no warning channel at all today; this package adds the
channel and its first warning together.

## Requirement

### Warn on a missing `C` row

PRODUCT — resolved: warnings go to stderr on every workflow load.

`validateDefinition` currently has no warning channel at all; every finding it
returns is merged into the one error `compileWorkflowConfig` throws at load
time. So this concern adds the channel and its first warning together: a
non-`prompt`, non-initial state that declares no `C` row.

- **Never a load-time error.** The no-op is a legitimate authoring choice, so
  this surfaces the decision — it does not force one.
- **Exempt the workflow's initial state explicitly.** A `C` row there would
  author a commit on every bare driver invocation.
- **Every warning goes to stderr, never stdout**, on every command that loads a
  workflow — which is every command whose `needsOf` is `"state"`. It repeats on
  every invocation until the workflow is fixed; that noise is accepted.
- Usually the omission is an oversight rather than a decision, and AGENTS.md
  already asks authors to make that call explicitly when adding a state.

Acceptance: a workflow whose non-initial `script` state declares no `C` row
loads successfully, exits 0, prints one warning naming that state on stderr and
nothing extra on stdout; the bundled `unified.yaml` produces exactly two —
`unwind` and `build.review.deciding` — both deliberately left unrouted (see Task
2's exclusions and its acceptance line below).

## Tasks

### Task 1 — Give `validateDefinition` a warning channel

`validateDefinition` returns `{ errors, warnings }` instead of
`readonly string[]` — one source of truth for every finding.

`src/PatternConfig.ts` is its **only production call site** (the
`definitionErrors` line inside `compileWorkflowConfig`) and reads `.errors`
where it reads the array today. `compileWorkflowConfig`'s
merge-into-one-thrown-error rule is unchanged, because warnings never reach it.

**The cost is test churn, not production churn: about 60 assertions in
`src/PatternMachine.test.ts` (mostly `toEqual([])`) plus 2 in
`src/workflows/templates.test.ts` all change shape.**

`src/PatternMachine.ts` stays pure — no git, no filesystem, no Effect. Its one
import is still `src/StateFields.ts`.

- [ ] `validateDefinition` returns an object with `errors` and `warnings`
- [ ] `compileWorkflowConfig` throws on `.errors` exactly as before, merging
      config-shape findings and definition findings into ONE error
- [ ] a workflow with warnings but no errors compiles successfully
- [ ] `src/PatternMachine.ts` imports nothing but `src/StateFields.ts`
- [ ] `npm run typecheck` and `npm run test:unit` are green

Paths: `src/PatternMachine.ts`, `src/PatternMachine.test.ts`,
`src/PatternConfig.ts`, `src/PatternConfig.test.ts`,
`src/workflows/templates.test.ts`

### Task 2 — Add the missing-`C`-row rule

A state warns when all four hold: it declares no `C` row, its content kind is
not `prompt`, it is not the workflow's initial state, and its actor is not
`human`.

**All three exclusions are load-bearing.** A `prompt` state's clean step is an
ATTEMPT by design — a clean tree with no `C` row there commits an empty
`gtd(<actor>): <state>` attempt, which is a real signal `stalledAt` reads. A `C`
row on the initial state would author a commit on every bare driver invocation.
A `human`-actor state is the same hazard generalized: `docs/driver.md`'s driver
protocol lands a human gate's OPENING beat unconditionally on every restart
while a process rests there, specifically because today that's a harmless no-op
when the state has no `C` row — a `C` row there would turn every such restart
into a real commit before the human has acted at all.

**Never a load-time error.** The no-op is a legitimate authoring choice, so this
surfaces the decision — it does not force one.

- [ ] a non-`prompt`, non-initial, non-`human`-actor state with no `C` row
      produces exactly one warning naming that state
- [ ] a `prompt` state with no `C` row produces no warning
- [ ] the workflow's initial state with no `C` row produces no warning
- [ ] a `human`-actor state with no `C` row produces no warning
- [ ] a state with a `C` row produces no warning
- [ ] the bundled `src/workflows/unified.yaml` produces exactly **two** warnings
      — `unwind` and `build.review.deciding` — each deliberately left unrouted:
      routing `unwind`'s clean case would mask a `git revert` failure silently
      swallowed by its `set +e` script (a completed revert and a failed one both
      leave a clean tree), and routing `build.review.deciding`'s clean case
      would auto-approve a review round whose `REVIEW.md` was never provisioned,
      rather than one a human actually signed off on. That repeating noise is
      accepted — do not chase zero by adding a `C` row to either.
- [ ] no warning is ever returned as an error

`packages.item.closing`'s own `"C": $onNext` row stands on its own merits, not
on this checklist: without it, a clean sweep (nothing left to remove) leaves the
process no-oping at `closing` forever, regardless of any warning target.

Paths: `src/PatternMachine.ts`, `src/PatternMachine.test.ts`,
`src/workflows/templates.test.ts`

### Task 3 — Add the ungated stderr channel

Add `warn` to the `Narrator` service in `src/Commentary.ts`, written to the same
stderr sink **ungated** — unlike `narrate`, it ignores the `verbose` flag the
layer was built with. One method on a service every command path already has in
context, rather than a second service and a second layer wiring.

`@inmem` e2e scenarios capture it in the buffer they already capture narration
and errors into, because the layer is built with `CliIo.stderr`.

- [ ] `Narrator.warn` writes to stderr with `verbose: false`
- [ ] `Narrator.narrate` still writes nothing with `verbose: false`
- [ ] `@inmem` scenarios observe a `warn` line in the same buffer they observe
      errors in

Paths: `src/Commentary.ts`, `src/Commentary.test.ts`

### Task 4 — Emit the warnings once per invocation

Emit inside `src/program.ts`'s `runCommand`, in the existing block that runs
exactly once per invocation when `needsOf(kind) === "state"`, ahead of
`dispatch` — one `Narrator.warn` line per warning.

**`ConfigService.load` is deliberately not the site: it is not memoized.** It
re-runs on every `yield*`, and a single `gtd land` loads config several times,
so warning there would print duplicates and force a dedupe set. `runCommand`
needs neither.

**Consequence to accept: `gtd visualize` (`needsOf: "config"`) and `gtd lsp`
(`needsOf: "none"`) print no warning.** `gtd lsp` also surfaces no diagnostic
for it — `lsp` diagnoses steering-file contents against a mode's parser and
never loads a workflow definition. The warning is CLI-only.

**Every warning goes to stderr, never stdout.** stdout stays the machine path on
every command — `--json`/`--sh` documents and the other commands' emitted
scripts are all consumed by a program, so a warning there would be parsed or
executed.

- [ ] one warning prints once per invocation, not once per config load
- [ ] the warning repeats on every subsequent invocation until the workflow is
      fixed; that noise is accepted
- [ ] stdout is byte-identical to a run with no warnings
- [ ] the exit code is 0
- [ ] `gtd visualize` and `gtd lsp` print no warning

Paths: `src/program.ts`, `src/program.test.ts`

### Task 5 — Add the e2e scenario

One new feature: a workflow whose non-initial `script` state declares no `C`
row.

Adding a feature file needs no `turbo.json` edit — the e2e tasks already glob
`tests/**`.

- [ ] the workflow loads successfully and the command exits 0
- [ ] exactly one warning naming that state appears on stderr
- [ ] nothing extra appears on stdout
- [ ] a scenario using the bundled workflow observes exactly its two accepted
      warnings (`unwind`, `build.review.deciding`)
- [ ] `npm test` is green

Paths: `tests/integration/features/`, `tests/integration/support/steps/`

## Out of scope

No `turbo.json` task and no `inputs` change: this package adds no new check.

No `src/Cli.ts` edit: no flag, no command, no scope exception. The warning is
unconditional, so there is nothing to gate.

This package adds no dependency and no config key.
