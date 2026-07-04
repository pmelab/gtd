# Spike: mutation testing with StrykerJS

Evaluate whether StrykerJS earns a permanent place in this repo by running it
against (a) the fast unit tests and (b) the in-memory e2e cucumber scenarios,
and reporting mutation scores, runtimes, and surviving mutants. This is a spike:
the deliverable is a written findings report plus a working (possibly rough)
config — not polished CI integration.

## Background (verified facts, don't re-derive)

- Test topology: `vitest.config.ts` defines two projects. `unit` = 329 tests in
  `src/*.test.ts` (~29s wall, but the time is concentrated: `Machine.test.ts` 75
  tests/9ms, `Prompt.test.ts` 53/5ms, `Config.test.ts` 23/226ms vs `Git.test.ts`
  61 tests/17s and `Events.test.ts` 95 tests/28s — those two spawn real git
  repos per test). `e2e` = 130 quickpickle cucumber scenarios, ~10s; 117
  untagged scenarios run in-process from `src/program.ts` with in-memory layers
  (see `tests/integration/support/hooks.ts` — tier dispatch), 13 tagged `@live`
  spawn the tsup bundle against real git.
- Stryker facts (as of @stryker-mutator/core 9.6.1, researched 2026-07):
  - The vitest runner does NOT support the `projects` array — it takes a single
    flat config via `vitest.configFile`. A dedicated config is required.
  - `coverageAnalysis` is forced to `perTest`; pool is forced to single-threaded
    `threads` (our e2e `pool: "forks"` / `fileParallelism` settings are
    overridden — fine, the inmem tier doesn't need forks).
  - Stryker copies the project to a `.stryker-tmp` sandbox (node_modules
    symlinked) and injects all mutants at once behind runtime switches; source
    files are never modified. No build step runs in the sandbox.
  - No `--since` flag; scoping is via `mutate` globs. `--incremental` caches
    results in `stryker-incremental.json`.
- Consequences for this repo:
  - `@live` scenarios must be skipped under Stryker: they execute
    `scripts/gtd.bundle.mjs`, which is prebuilt — mutants in `src/` never
    activate there, so every mutant would spuriously "survive". Also the sandbox
    has no fresh bundle.
  - `src/Perf.test.ts` must be excluded: mutation instrumentation slows code
    down, so timing assertions will flake.
  - `src/Machine.property.test.ts` (fast-check) should be excluded for the
    spike: unseeded properties make kill results nondeterministic. (Follow-up if
    adopted: pin seed + lower numRuns instead.)

## Tasks

### 1. Install and scaffold

- [ ] `npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker`
      (all same major, 9.x). Verify the runner's peer range accepts our vitest
      3.2; if it demands vitest 4, note it in the findings and try anyway / pin
      the newest runner version that accepts 3.x.
- [ ] Add `.stryker-tmp/`, `stryker-incremental.json`, and `reports/` to
      `.gitignore` and `.prettierignore`.

### 2. Skip mechanism for `@live` scenarios

- [ ] In `tests/integration/support/hooks.ts`, skip any `@live`-tagged scenario
      when `process.env.GTD_SKIP_LIVE === "1"` (quickpickle worlds carry the
      vitest `TestContext`; `world.context.skip()` or the quickpickle-idiomatic
      equivalent). Untagged scenarios unaffected.
- [ ] Acceptance: `GTD_SKIP_LIVE=1 npm run test:e2e` passes with exactly 13
      scenarios skipped and does not require `scripts/gtd.bundle.mjs` to be
      fresh.

### 3. Dedicated vitest config for Stryker

- [ ] Create `vitest.stryker.config.ts`: single project (no `projects` array),
      both the `rawMd()` plugin (extract it from `vitest.config.ts` into a
      shared module rather than duplicating) and
      `quickpickle({ stepTimeout: 30_000 })`.
  - include: `src/**/*.test.ts` + `tests/integration/features/**/*.feature`
  - exclude: `src/Perf.test.ts`, `src/Machine.property.test.ts`
  - setupFiles: same five files as the e2e project in `vitest.config.ts`
  - `test.env: { GTD_SKIP_LIVE: "1" }`
  - no custom reporter, no forks pool, no `fileParallelism: false`
- [ ] Acceptance: `npx vitest run --config vitest.stryker.config.ts` is green
      and finishes in well under a minute.

### 4. Stryker config + first run (pure core)

- [ ] Create `stryker.config.json`:
  - `testRunner: "vitest"`, `vitest: { configFile: "vitest.stryker.config.ts" }`
  - `mutate: ["src/Machine.ts", "src/Prompt.ts", "src/Config.ts", "src/Format.ts", "src/State.ts"]`
  - `checkers: ["typescript"]`, `tsconfigFile: "tsconfig.json"`
  - `ignoreStatic: true`
  - `reporters: ["html", "clear-text", "progress"]`
  - do NOT set `coverageAnalysis` (forced to perTest anyway)
- [ ] Run `npx stryker run`. If the typescript-checker misbehaves with the
      Effect-heavy types (crashes, extreme slowness), drop it and note that in
      findings. Record: total mutants, killed / survived / timeout / no-coverage
      / compile-error counts, wall-clock time.
- [ ] Note: Events.test.ts/Git.test.ts are in the config and will slow the dry
      run (~45s) — acceptable for the spike. If perTest coverage shows them
      covering core-module mutants and per-mutant time explodes, exclude them
      and rerun; record both timings.

### 5. Experiment: scenario-only kill power

Measures what the cucumber layer alone pins down — the primary question.

- [ ] Copy the stryker vitest config to a variant including ONLY
      `tests/integration/features/**/*.feature` (no `src/**/*.test.ts`), run
      Stryker with the same `mutate` list against it (separate stryker config
      file or `--vitest.configFile` override; keep separate
      `stryker-incremental` files or disable incremental).
- [ ] Compare per-file mutation scores against the run from task 4. Mutants
      killed by unit tests but survived by scenarios = behavior no scenario
      asserts — list the notable ones.

### 6. Stretch (timebox ~30 min of run time): the I/O edge via inmem scenarios

- [ ] Using the scenario-only config from task 5, add `src/Events.ts` (and
      `src/Git.ts` if time allows) to `mutate`. Because the slow git-spawning
      unit tests are excluded from this config, mutants there are killed only by
      the ~10s scenario suite — this tests whether mutating the edge is
      affordable at all. Abort and record the projection if the run clearly
      exceeds the timebox.

### 7. Findings report

- [ ] Write `SPIKE-STRYKER.md` (repo root) with:
  - setup that worked (versions, configs, gotchas hit — especially anything that
    contradicts the Background section above)
  - results table: per run — mutants, score, killed/survived/timeout counts,
    wall-clock
  - top ~10 surviving mutants with a one-line judgment each: real test gap /
    equivalent mutant (undetectable by any test) / low-value
  - recommendation: adopt or not; if adopt — which mutate scope, whether the
    typescript-checker stays, on-demand vs CI (`--incremental`), and what a
    `test:mutation` npm script should run
- [ ] If (and only if) the spike leaves permanent scripts/config in the repo,
      reflect them in README.md.

## Out of scope

- CI wiring, mutation-score thresholds/gates
- Mutating `@live`-covered paths, `scripts/gtd.js`, `dev/`, or the tsup bundle
- Fixing any test gaps the report surfaces (that's a follow-up plan)
- Pinning fast-check seeds / re-including property tests
