# 01 — Make the mutation suite runnable

## Requirement

> ### 1. Make the mutation suite runnable (TECHNICAL)
>
> **The mutation run cannot complete a dry run on this branch.** Both fixes that
> made the `main` run possible are absent here; I verified both. Nothing below
> is measurable until this lands, so it is first.
>
> - **`vitest.stryker.config.ts` is missing four setup files** that
>   `vitest.config.ts` lists: `steering`, `repo-snapshot`, `signal-exit`,
>   `tmpdir-gitdir`. Nine scenarios fail as undefined steps whenever the
>   mutation runner drives the suite. Extract the list into a single shared
>   module (`tests/integration/support/setup-files.ts`) imported by both
>   configs, so the two cannot drift again.
> - **`src/program.test.ts`'s `gtd lsp` test hands the real `process.stdin` to
>   vscode-languageserver.** That installs an `end`/`close` listener calling
>   `process.exit(1)`, and interrupting the Effect fiber does not remove it.
>   Under vitest it fires as an uncaught exception long after the test; Stryker
>   then crashes stringifying it (`errorToString`: "Cannot convert object to
>   primitive value") and **aborts the dry run**. This is the actual blocker.
>   Stub `process.stdin` with a `PassThrough`.
>
> Acceptance: a `tests/tooling/` test asserting both vitest configs resolve the
> same setup-file list — it fails against today's four-file drift. Plus a clean
> `npx stryker run --dryRunOnly` (or equivalent short run) that no longer
> aborts.
>
> **Add no `thresholds` block to `stryker.config.json`.** The score stays a
> diagnostic a person reads on purpose, never a gate that fails. Nothing runs
> `test:mutation` often enough for a `break` floor to catch a regression near
> the commit that caused it, and a floor would turn every future unrelated
> refactor into a 13-minute argument with Stryker.
>
> Risk, stated plainly: **with no floor, the score this work lands at will decay
> again and nobody will notice until the next deliberate run.** That is the
> accepted cost of keeping the task opt-in.

## Paths

- `tests/integration/support/setup-files.ts` (new)
- `vitest.config.ts`
- `vitest.stryker.config.ts`
- `tests/tooling/setup-files.test.ts` (new)
- `src/program.test.ts`
- `turbo.json`
- `stryker.config.json` (asserted unchanged)

## Task 1 — Extract the setup-file list into one shared module

**One plain `readonly string[]`, no object and no factory.**
`tests/integration/support/setup-files.ts` exports `SETUP_FILES` — the same 13
`"./tests/integration/support/..."` strings `vitest.config.ts` lists today, in
document order.

**Literal strings work for every consumer because vitest resolves `setupFiles`
relative to its own config's directory, and both configs sit at the repository
root.** Three consumers spread the list: the `e2e-inmem` project, the `e2e-live`
project, and `vitest.stryker.config.ts`.

**The four missing files come along by construction** — `steering`,
`repo-snapshot`, `signal-exit`, `tmpdir-gitdir`.

**No `.fallowrc.json` change.** The new module is already an entry point via the
existing `tests/integration/support/**/*.{ts,mjs}` glob, so fallow will not
report it dead.

- [ ] `tests/integration/support/setup-files.ts` exports `SETUP_FILES` with all
      13 paths in the order `vitest.config.ts` lists them today
- [ ] Both `e2e-inmem` and `e2e-live` projects in `vitest.config.ts` spread
      `SETUP_FILES` instead of an inline array
- [ ] `vitest.stryker.config.ts` spreads `SETUP_FILES` instead of its inline
      9-entry array
- [ ] The nine scenarios that failed as undefined steps under the mutation
      runner now resolve their steps
- [ ] `npm run deadcode` stays green with no `.fallowrc.json` edit

## Task 2 — Pin the two configs against future drift

**The pin is a `tests/tooling/` test, same class as the existing
`turbo.test.ts`.** `tests/tooling/setup-files.test.ts` imports `SETUP_FILES` and
both config modules — vitest transforms the TS configs on import — then asserts
three things.

**The third assertion is not redundant: equality alone passes happily when a
step-definition file is renamed and all three consumers point at the same
missing path.**

- [ ] `tests/tooling/setup-files.test.ts` asserts the stryker config's
      `test.setupFiles` equals `SETUP_FILES`
- [ ] It asserts every `e2e-*` project in `vitest.config.ts`'s `test.projects`
      has `setupFiles` equal to `SETUP_FILES`
- [ ] It asserts every listed path exists on disk via `existsSync`
- [ ] Reverting the stryker config to today's 9-entry array makes the test fail

## Task 3 — Close the under-declared turbo inputs

**`turbo.json`'s `test:unit` inputs are under-declared for the new test and must
grow three entries:** `vitest.stryker.config.ts`, `stryker.config.json`, and
`tests/integration/support/**`.

Risk in one line: **without those three, the new pin caches a stale green while
the stryker config drifts** — the same trap `docs/**` in the e2e inputs exists
to avoid.

**No new turbo task, so `turbo.test.ts` needs no edit.** This adds a test, not a
task, and the script/task/test-list trio it enforces applies only to tasks.

- [ ] `turbo.json`'s `test:unit` `inputs` contains `vitest.stryker.config.ts`
- [ ] `turbo.json`'s `test:unit` `inputs` contains `stryker.config.json`
- [ ] `turbo.json`'s `test:unit` `inputs` contains
      `tests/integration/support/**`
- [ ] `tests/tooling/turbo.test.ts` is unchanged and still passes
- [ ] Editing `vitest.stryker.config.ts` alone causes `turbo run test:unit` to
      re-run rather than hit cache

## Task 4 — Stub `process.stdin` in the `gtd lsp` unit test

**This is the actual dry-run blocker.** The test hands the real `process.stdin`
to vscode-languageserver, which installs an `end`/`close` listener that calls
`process.exit(1)`. Interrupting the Effect fiber does not remove it, so it fires
as an uncaught exception long after the test, and Stryker crashes stringifying
it (`errorToString`: "Cannot convert object to primitive value") and aborts the
dry run.

**`process.stdin` is a getter, so replace it with
`Object.defineProperty(process, "stdin", { value: passThrough, configurable: true })`**
using a `PassThrough` from `node:stream`, and restore the saved original
descriptor in `afterEach`.

**No try/catch anywhere.** Swallowing the exception would leave the listener
attached, which is the defect itself.

- [ ] The `gtd lsp` test in `src/program.test.ts` installs a `PassThrough` over
      `process.stdin` before running the CLI
- [ ] The original `process.stdin` property descriptor is restored in
      `afterEach`
- [ ] No try/catch is added around the fiber or the exception
- [ ] `npm run test:unit` reports no uncaught exception after the suite finishes
- [ ] `npx stryker run --dryRunOnly` completes without aborting

## Task 5 — Keep the mutation score ungated

**Add no `thresholds` block to `stryker.config.json`, and keep `test:mutation`
out of both `npm test` and `turbo.json`.** A `break` floor would fire during
unrelated refactors and still miss real regressions, because nothing triggers a
13-minute run near the commit that caused one.

Risk, stated plainly: **with no floor, the score this work lands at will decay
again and nobody will notice until the next deliberate run.** That is the
accepted cost of keeping the task opt-in.

- [ ] `stryker.config.json` has no `thresholds` key
- [ ] `package.json`'s `test` script does not name `test:mutation`
- [ ] `turbo.json` has no `test:mutation` task
