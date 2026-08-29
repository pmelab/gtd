# Review: e610743

<!-- base: 27f20a4d4862799b363365901cea4a2af29ef9ed -->

Mutation-testing gap closure. **~1160 new test lines, three production exports
widened, one dead parameter deleted, and a real change to how the e2e and
mutation suites are configured.** The test additions are mechanical; the config
moves carry the risk.

## Production code touched

Only three files under `src/` change behavior or surface. **One is a verified
no-op; three widen exports purely so tests can reach them.**

- [ ] ./src/Edge.ts#627 — drops the `currentCost`/`currentModel` parameters from
      `buildTemplateContext` and stops folding an in-flight step's cost into
      `it.processCost`/`it.processCostByModel`. Verified no-op: both call sites
      (`summaryTemplateContext`, `restAt`) already passed `0`/`undefined`, so
      the fold branch was dead. `UNATTRIBUTED_MODEL` is still used at line 91,
      so the export does not go stale.
- [ ] ./src/Lsp.ts#440 — `mergeStaticVars` goes from private to exported. No
      caller outside tests.
- [ ] ./src/Lsp.ts#492 — `makeNodeLspEnv` goes from private to exported, so a
      test can drive the real git/config/repo-files layers against a temp repo.
      The old doc comment said "not exported" as a deliberate design point; the
      new one reverses that. Judge whether the real-wiring test is worth the
      widened surface.
- [ ] ./src/PatternConfig.ts#776 — `compileState` exported so its non-object
      `raw` guard is directly testable. The comment states plainly that the
      guard is unreachable through `compileWorkflowConfig` because
      `Machines.ts`'s `emitState` normalizes first — so this export exists to
      cover a branch that cannot fire in production.

## Shared e2e setup-file list

The 13-entry `setupFiles` array was pasted in three places. It is now one
exported constant plus a test that pins all three consumers to it.

- [ ] ./tests/integration/support/setup-files.ts#1 — the new `SETUP_FILES`
      constant.
- [ ] ./tests/tooling/setup-files.test.ts#1 — guards that every entry exists on
      disk and that both `e2e-*` projects and the stryker config use the shared
      list.
- [ ] ./vitest.stryker.config.ts#11 — **behavior change, not a pure refactor:
      the stryker config previously listed only 9 setup files; it now loads
      all 13.** `steering.steps.ts`, `repo-snapshot.steps.ts`,
      `signal-exit.steps.ts`, and `tmpdir-gitdir.steps.ts` now register during
      every mutation run. Confirm that is intended and not an accident of
      deduplication — it changes what `npm run test:mutation` executes.
- [ ] ./vitest.config.ts#36 — both e2e projects switch to `[...SETUP_FILES]`.

## Coverage wiring

New `@vitest/coverage-v8` dev dependency and a manual `coverage` script. Scope
is derived from stryker's `mutate` array so coverage and mutation scope cannot
drift apart.

- [ ] ./vitest.config.ts#9 — `readFileSync("./stryker.config.json")` at config
      load time. **Risk: this runs for every project, including both e2e ones,
      but `stryker.config.json` is only in `test:unit`'s turbo `inputs`.** A
      malformed or missing `stryker.config.json` breaks e2e config load while
      turbo can still serve those two tasks a cached green. Low likelihood,
      silent when it happens.
- [ ] ./vitest.config.ts#17 — `include: strykerConfig.mutate`. Untyped
      `JSON.parse`; nothing asserts `mutate` exists or is an array.
- [ ] ./package.json#48 — `coverage` script. It has no turbo task, which is
      allowed: `tests/tooling/turbo.test.ts` only requires a script for every
      task, not the reverse. It is a manual tool like `test:mutation`.
- [ ] ./turbo.json#37 — adds `tests/integration/support/**`,
      `vitest.stryker.config.ts`, and `stryker.config.json` to `test:unit`'s
      inputs. Correct — the new tooling test imports all three.

## e2e-live parallelism and timeouts

- [ ] ./package.json#47 — **`fileParallelism: false` moves out of the vitest
      config and into the `test:e2e:live` npm script as
      `--no-file-parallelism`.** The comment explains vitest resolves the option
      before projects split. The consequence: running
      `vitest run --project e2e-live` directly, without the npm script, now runs
      files in parallel and reintroduces the cross-step IPC stalls the flag
      exists to prevent. Nothing tests or guards this flag, unlike `setupFiles`.
      Turbo invokes the script, so CI is fine.
- [ ] ./vitest.config.ts#54 — the explanatory comment for the above.
- [ ] ./vitest.config.ts#48 — e2e-live `stepTimeout` raised 60s → 120s.
- [ ] ./tests/integration/support/steps/driver-doc.steps.ts#127 — matching
      `execFile` timeout raised to 120s. The two must stay equal and both below
      `testTimeout` (300s); they do.
- [ ] ./tests/integration/support/hooks.ts#26 — comment rewrite only, tracking
      the removed `fileParallelism: true` on `e2e-inmem` (now vitest's default).

## New tests — error-message and boundary coverage

Roughly 1160 added lines across eight test files. All pin exact strings or exact
boundaries, the two things mutation testing catches and substring assertions
miss.

- [ ] ./src/Edge.test.ts#92 — no-actor refusal, edge `describe`/`action`
      round-trip, and five refusal messages asserted as whole strings rather
      than `toContain`: joined pattern lists, `(none)` fallbacks, and `it.vars`
      reference lists that must not truncate multi-char names to one char.
- [ ] ./src/ReviewDoc.test.ts — cursor geometry at hunk and chunk span
      boundaries, chunk-toggle majority rule on even splits, last-chunk range
      with and without a trailing newline, CRLF equivalence, and whitespace
      trims.
- [ ] ./src/OpenQuestions.test.ts — outline fold ends, optional `children`, CRLF
      equivalence, heading regex `^`/`$` anchors, and whitespace handling.
- [ ] ./src/PatternConfig.test.ts#573 — unreadable file ref, non-object
      `machines:`, non-object `retry:`, top-level `summary` file ref, and the
      directly-called `compileState` guard.
- [ ] ./src/Config.test.ts#565 — malformed YAML/JSON, scalar `null`, and
      top-level array configs; plus `configPresentAt`'s three outcomes.
- [ ] ./src/PatternMachine.test.ts#712 — `on` edges targeting a missing state
      and a state with no actor.
- [ ] ./src/SteeringMode.test.ts#520 — empty `format:` output produces no
      suffix; trailing whitespace is trimmed but leading whitespace is kept.
- [ ] ./src/Lsp.test.ts — `initialize` capabilities, `codeAction` mapping,
      `definition` falling back when `gitTopLevel` rejects, `mergeStaticVars`
      layering, `makeNodeLspEnv` against a real temp repo, and the `exit`
      notification path.

## Global stdin stub in a unit test

- [ ] ./src/program.test.ts#260 — the `gtd lsp` test replaces `process.stdin`
      with a `PassThrough` and an `afterEach` restores it. **Reason given: the
      language server installs an `end`/`close` listener that calls
      `process.exit(1)`, which survives fiber interruption and crashes Stryker's
      dry run later.** Real fix for a real problem, but it is a mutation of
      global process state inside a parallel-capable unit file. The `afterEach`
      is describe-scoped and the guard variable is only set by the one test, so
      the blast radius is contained — worth a second look anyway, since a future
      test in that same describe inherits the restore hook.
