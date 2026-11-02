# Spike: Vite+ (vite-plus 1.4.0) for gtd

Branch `spike/vite-plus`. Findings, not a mergeable PR. Machine: macOS arm64,
Node 24.20.0, npm 11.19.0.

## Verdict: adopt partially

- **Vitest 5: adopt now.** Every project is green on vitest 5.0.5 (plain
  `vitest`). It costs one import fix and one npm `overrides` entry.
- **`vp run` instead of turbo: viable, but adopt only after the caveats below
  are accepted or fixed upstream.** Auto-tracking replaced every hand-kept
  `inputs` glob and fixed the `docs/**` stale-green case without help. It also
  found an input turbo over-declared. But on macOS it has its own stale-green
  hole: reads made by `/usr/bin/git` are not tracked. It is also fail-fast, has
  no `--continue`, and keeps only one cache entry per task+env key, so it does
  not reuse results on revert or branch switch.
- **Config consolidation into `vite.config.ts`: don't, for now.** The `fmt` and
  `lint` blocks work and match today's results. But `vp check`'s type-aware path
  reports 421 new errors, so moving to it is its own project. The Effect
  language service is not lost: `tsc` never ran it either.

## Phase 1: Vitest 5 compatibility

Baseline was vitest 4.1.12 + turbo 2.10.9, all green. Each project ran alone, in
order:

| project   | vitest 4 | vitest 5.0.5 | vitest 5 result                                           |
| --------- | -------- | ------------ | --------------------------------------------------------- |
| unit      | 64s      | 60s          | 163 files, 3660 passed, 5 skipped                         |
| workflows | 3s       | 2s           | 5 files, 30 passed, 4 expected fail, 1 skipped            |
| e2e-inmem | 12s      | 11s          | 79 files, 653 passed, 30 skipped                          |
| e2e-live  | 225s     | 130s         | 25 files, 163 passed, 30 skipped                          |
| storybook | 16s      | 15s          | 11 files, 251 passed (`@vitest/browser-playwright@5.0.5`) |

The e2e-live gap (225s → 130s) is probably machine load, not vitest. It was not
re-measured.

What broke, and the fixes:

- **Typecheck:** vitest 5 removed the `vitest/reporters` subpath. This fails
  only in `tsc`, because the reporter's import is type-only:
  `tests/vitest.reporter.ts(1,31): error TS2307: Cannot find module 'vitest/reporters'`.
  Fix: import from `vitest/node`, which also exists in v3 and v4.
- **npm resolution:** `storybook@10.6.5` (latest) declares the optional peer
  `vite-plus@"^0.1.15 || ^0.2.0"`, and npm enforces it once vite-plus is
  installed → `ERESOLVE`. `11.0.0-alpha.8` only widens the range to `^0.3.0`.
  Fix: `"overrides": { "storybook": { "vite-plus": "$vite-plus" } }`. The stale
  `vitest`/`@vitest/*` lockfile entries also had to be deleted before npm would
  resolve.
- **Hoisting:** vite-plus pins `oxlint =1.89.0` / `oxfmt =0.74.0`, and npm
  hoisted oxlint 1.89 to the root. That version adds React-compiler rules, and
  `oxlint .` failed with 3 errors (`react(static-components)`, refs). Fix: pin
  `oxlint 1.74.0` and `oxfmt 0.59.0` exactly in devDependencies.
- **quickpickle 1.11.2:** works unchanged on v5. `src/gherkin/index.ts` still
  imports plain `vitest`, a type-only `TestContext`, so the published peer
  `vitest >=3.2.0` still holds.
- **Through `vp test` instead of `vitest`:** workflows, e2e-inmem and storybook
  are green, but unit has **2 failures** in
  `tests/tooling/steering-oxfmt.test.ts`. The cause: `vp` exports `VP_VERSION`,
  and oxfmt reads it
  (`process.env.VP_VERSION ? loadVitePlusConfig : loadJsConfig`), switches to
  looking for `vite.config.ts`'s `fmt` block, and silently ignores
  `.oxfmtrc.json`: `No config found, using defaults`. The test formats inside a
  temp dir with a copied `.oxfmtrc.json`, so it gets defaults. Any child oxfmt
  started under `vp test`/`vp <cmd>` behaves the same. `vp run` tasks do NOT see
  `VP_VERSION`.
- **Stryker vitest-runner smoke: works.** `@stryker-mutator/vitest-runner@9.6.1`
  on vitest 5.0.5, mutating only `src/wire/Demand.ts` against
  `src/wire/Demand.test.ts` (a throwaway config with just `rawMd()`, no
  checker): 55 mutants, 1 killed, 53 survived, 1 no coverage, **0 errors**,
  3.8s. The low score is expected: that one test file barely touches the mutated
  code. This shows the runner and per-test coverage work. It is not a
  mutation-score comparison. The full `npm run test:mutation` was not run.

## Phase 2: turbo → `vp run`

What is on this branch: `vite.config.ts` `run.tasks` mirror `turbo.json`. Turbo,
`turbo.json` and `tests/tooling/turbo.test.ts` are removed.
`scripts/test-states.ts` spawns `vp run --log labeled <gate>`, and
`tests/tooling/vp-run.test.ts` replaces the turbo invariants.

### Timings (`npm test`, release registry empty, so one state)

| run                                                 | wall               | cache            |
| --------------------------------------------------- | ------------------ | ---------------- |
| turbo baseline, near-cold (2/12 already cached)     | 292s               | 2/12             |
| turbo baseline, warm                                | 0.42s              | 12/12            |
| vp cold (no `dist/`, empty task cache)              | 172s               | 0/19             |
| vp warm #1, before the pollution fixes              | 72s                | 10/19            |
| vp after the input-config change (all miss)         | 166.6s             | 0/19             |
| vp warm, steady state                               | 0.76s              | 19/19            |
| vp after editing `docs/driver.md`                   | 133.0s             | 13/19            |
| vp after reverting `docs/driver.md`                 | 132.4s             | 13/19, no reuse  |
| final run after editing `vite.config.ts`, then warm | 160.6s, then 0.86s | 8/19, then 19/19 |

The cold numbers are not a fair speed comparison: turbo ran vitest 4 with 10
concurrent tasks, `vp` runs 4 by default. Counts are sub-tasks: `vp` splits each
`&&` part into its own cached task, so build alone is 6 entries.

### Stale-green check: `docs/driver.md`, no hand-declared `docs/**`

Editing it invalidated `test:unit`, `test:e2e:live`, `test:web`, `format:check`,
`analyze` and the build's tailwind step, which scans the repo.
**`test:e2e:inmem` correctly stayed a hit.** No `@inmem` scenario reads
`driver.md`; `driver-doc.feature` is `@live`. So turbo's `docs/**` on e2e:inmem
was over-declared.

### Fingerprint pollution, and the excludes that fixed it

Auto-tracking records directory listings and ignores `.gitignore`. Inputs needed
for every task:

```ts
;[
  { auto: true },
  "!dist/**",
  "!src/ui/client.generated.html",
  "!node_modules/.vite/**",
]
```

- `'client.generated.html' added in 'src/ui'`: lint, analyze, format:check,
  lint:boundaries and tailwind run alongside build and list `src/ui`. An
  excluded file still counts in the listing, so after a cold run with no
  `dist/`, the next run misses once. In steady state it is gone.
- `node_modules/.vite/vitest/<hash>/results.json modified`: vitest's results
  cache, shared by every vitest task. Workflows, web and inmem all missed.
- `node_modules/.vite/task-cache/v18/cache.db modified`: test:unit read vp's own
  cache DB.
- **TMPDIR and spawned git did not pollute.** After the excludes, a full
  `npm test` replays 19/19.

### Caveats found

1. **macOS: reads by `/usr/bin/git` are not tracked → stale cache hit.** A probe
   task ran `git hash-object zz-probe.txt`; after editing the file, it still got
   `cache hit` and replayed the OLD hash. `/bin/sh` and node reads are tracked.
   The cause is SIP stripping the `DYLD_INSERT_LIBRARIES` that fspy injects into
   cached tasks. Linux CI (LD_PRELOAD) is likely fine; this was not verified.
2. **Fail-fast.** The first failing task kills its siblings with exit 137, and
   there is no `--continue`. One red task hides the others' results.
3. **One cache entry per task+args+env.** Reverting a file does not reuse the
   earlier result (turbo is content-addressed and would). Env values do get
   separate entries: flipping `GTD_FLAG_SPIKE` 0/1/0/1 hit on the 3rd and 4th
   runs, so flag states will not thrash each other.
4. **`&&` parts run without a shell**: `shellcheck tests/shell/corpus/*.sh` got
   the literal glob. Fix: wrap it in `sh -c '…'`.
5. **One task per invocation.** `vp run a b` passes `b` as an argument to `a`,
   so the runner needs aggregate tasks: `gate` (all) and `gate:tests` (vitest
   ones). Flags must come before the task name; after it, they go to the
   command.
6. **A task cannot share its name with a package.json script**
   (`Failed to load task graph … conflicts`). So
   `npm run build/lint/test:unit/…` are gone and it is `vp run <task>` now.
   `tests/vitest.ensureWebClient.ts` reads the build command from
   `vite.config.ts` instead.
7. **Clean env applies only to cached tasks.** `cache: false` tasks get the full
   parent env. Cached tasks get a small allowlist plus every `*_TOKEN` variable
   (default untracked pattern), which leaks tokens into tests.
8. **fallow lost entry points.** It reads package.json scripts, not
   `vite.config.ts`, so `scripts/assert-no-test-doubles.mjs`,
   `scripts/generate-shell-corpus.ts` and `@tailwindcss/cli` turned up as
   unused. They are now listed in `.fallowrc.json`.
9. **Restoring the cache across GitHub Actions runs is marked experimental
   upstream.** The CI step is moved after `npm install` and caches
   `node_modules/.vite/task-cache`. Untested.
10. vite-plus#2635 (no declared `output` → a hit can drop files): `build`
    declares `output: ["dist/**", "src/ui/client.generated.html"]`, and every
    check/test task declares `output: []`. Pinned by `vp-run.test.ts`.

### What `tests/tooling/turbo.test.ts` became

`tests/tooling/vp-run.test.ts` checks that:

- `gate`/`gate:tests` dependsOn equal `TASKS`/`VITEST_TASKS`;
- `GTD_FLAG_*` is fingerprinted on exactly the vitest tasks;
- every test task except test:web depends on build;
- build's outputs are explicit (#2635);
- every cached task's input is `auto` plus the four excludes;
- `scripts/` is typechecked;
- the web-client packages are not runtime dependencies.

All the `inputs`-contains-X tests (`docs/**`, `.claude/skills/**`,
`.storybook/**`, the analyze ⊇ lint superset) are deleted: auto-tracking covers
them.

## Phase 3: config consolidation (partial)

`vite.config.ts` now has `fmt` and `lint` blocks, read from the existing
`.oxfmtrc.json`/`.oxlintrc.json`. Those files are JSONC, so they are parsed with
`ts.parseConfigFileTextToJson`. The standalone tools keep working.

- `vp fmt --check .` (oxfmt 0.74): **fixed point**, 496 files, 0.96s. A probe
  confirmed the md override (printWidth 80, proseWrap) is applied.
- `vp lint` (oxlint 1.89, vite-plus mode): **clean**, 117 rules. Same as
  `oxlint .` 1.74.
- `vp check` with `typeAware: true, typeCheck: true`: 2.18s versus ~4–12s for
  the two `tsc` runs, but **421 errors**:
  - 320 `no-floating-promises` (319 in `src/web`), plus `unbound-method` 9,
    `no-base-to-string` 8 and others;
  - 74 TS errors, all **outside tsc's scope**: 72 in
    `claude/hooks/register.tsx`, 1 in `claude/hooks/ship.ts`, 1 in
    `.storybook/preview.tsx` (`TS2882`);
  - **0 TS errors in `src`/`tests`/`scripts`**, which matches tsc.
- `@effect/language-service`: it is a `tsconfig` plugin, and plugins run only in
  tsserver. `tsc --noEmit` does not run it either (`typescript` is not patched),
  and tsgolint has no plugin support. So neither tool enforces it.
- The `tsdown.config.ts` → `pack` and `vitest.config.ts` → `test` folds were not
  attempted.

## Remaining migration steps

1. **Vitest 5 (S, about ½ day):** bump vitest/@vitest/* to 5.0.5 and storybook
   to 10.6.5; add the storybook `overrides`; fix the `vitest/node` import;
   regenerate the lockfile cleanly. Independent of vite-plus, except the
   override is needed only once vite-plus is installed.
2. **`vp run` (M, 1–2 days):** about 90% done on this branch. Still to do:
   - the AGENTS.md "Task graph and caching" section;
   - `docs/development.md`;
   - the `.claude/settings.json` allowlist (`npm run X` → `vp run X`);
   - `.github/workflows/release.yml` (`npm run build`);
   - 5 stale turbo comments (`src/ui/Server.test.ts`,
     `src/emit/GitScript.test.ts`, `tests/integration/support/world.ts`,
     `scripts/bench-replay.mjs`, `vitest.config.ts`);
   - the `.gitignore` `.turbo/` entry;
   - a decision on fail-fast and the macOS git caveat, or upstream issues for
     both;
   - measure the CI cache restore.
3. **Upstream issues to file (S):**
   - git/SIP tracking on macOS (vite-plus/vite-task);
   - storybook's `vite-plus` peer range (storybook);
   - oxfmt switching config discovery on an inherited `VP_VERSION` in a
     directory that has no `vite.config.ts` (oxc).
4. **Consolidation (L, optional):**
   - triage the 421 type-aware findings, or disable those rules;
   - move `format:check`/`lint`/lint-staged to `vp fmt`/`vp lint`/`vp staged`
     and drop the separate oxfmt/oxlint pins;
   - make `steering-oxfmt.test.ts` strip `VP_VERSION`;
   - fold the multi-config tsdown setup into `pack`.
