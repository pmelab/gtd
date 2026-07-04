# TODO: Migrate Gherkin e2e tests from cucumber-js to quickpickle (vitest)

## Goal

Run the existing `.feature` files under vitest via the **quickpickle** plugin,
so there is one test runner for unit + e2e, feature files parallelize across
vitest workers, and the cucumber-js/tsx/md-loader toolchain can be deleted. No
per-feature spec files — feature files stay the tests, step definitions stay
shared.

## Why quickpickle (research summary, 2026-07)

- `quickpickle` v1.11.x (active, May 2026): vitest plugin, `.feature` files go
  directly into `test.include` and run as vitest test files. CucumberJS parity:
  `Given/When/Then` with cucumber expressions, `setWorldConstructor`, hooks
  (`BeforeAll/Before/After/BeforeStep/AfterStep`, tagged), DataTables,
  DocStrings, official Gherkin parser, tag-driven
  `@skip/@todo/@concurrent/@sequential`. Peer dep `vitest ^1 || >=2` — we're on
  vitest ^3.2.0. Docs: https://github.com/dnotes/quickpickle
- Rejected: `@amiceli/vitest-cucumber` (popular but requires one `.spec.ts`
  mirror file per feature — boilerplate we explicitly don't want),
  `vitest-cucumber-plugin` (superseded by quickpickle),
  `@deepracticex/vitest-cucumber` + `vitest-gherkin` (dead).
- Fallback if quickpickle turns out to block on something: stay on
  `@cucumber/cucumber` (current setup works; this migration is DX, not a fix).

## Current state (what you're migrating)

- Runner: `@cucumber/cucumber` v12, config `tests/integration/cucumber.mjs`
  (paths `tests/integration/features/`, import
  `tests/integration/support/**/*.ts`, loader `md-loader.mjs`,
  `format: summary`, `parallel: 4`, `tags: "not @skip"`).
- Invocation: `test:e2e` script =
  `NODE_OPTIONS=--import=tsx npx cucumber-js ...`, with `pretest:e2e` building
  `scripts/gtd.bundle.mjs` via tsup.
- 19 feature files in `tests/integration/features/`.
- Support code (~2100 lines):
  - `support/world.ts` — `GtdWorld extends World` (cucumber). Two tiers: `inmem`
    (default; in-process Effect program with `support/inmem/` layers) and `live`
    (`@live` tag; spawnSync of `scripts/gtd.js`, 30s/120s timeouts).
  - `support/hooks.ts` — `BeforeAll` runs `npm run build`; `Before` reads
    `scenario.pickle.tags` to pick tier; `After` cleans up live-tier temp dirs.
  - `support/steps/*.steps.ts` (5 files) — cucumber-style steps using bound
    `this: GtdWorld` (~145 `this.` usages total, uniform pattern).
  - `support/md-loader.mjs` — node loader so support code can import `.md`
    fixtures. `vitest.config.ts` already has an equivalent `rawMd` vite plugin.
  - `support/formatter.ts` — cucumber formatter (delete; vitest reporter
    replaces it).
- Unit tests: vitest with custom reporter `tests/vitest.reporter.ts`,
  `include: src/**/*.test.ts`.

## Baseline first

Before touching anything, record the baseline so you can prove parity:

```sh
npm run test:e2e 2>&1 | tail -5   # note scenario/step counts + pass status
```

The same scenario count (minus `@skip`) must pass after migration.

## Migration steps

1. `npm install -D quickpickle` (keep `@cucumber/cucumber` installed until the
   final step so you can compare runs).

2. **vitest config** — split into two projects (vitest 3 `test.projects` /
   `defineProject`): keep the existing `unit` project as-is; add an `e2e`
   project with:
   - `plugins: [rawMd(), quickpickle()]` (rawMd replaces `md-loader.mjs`)
   - `include: ["tests/integration/features/**/*.feature"]`
   - `setupFiles`: the world file, hooks file, and all `steps/*.steps.ts`
     (explicit list; quickpickle registers steps at import time)
   - shared `reporters: ["./tests/vitest.reporter.ts"]`
   - `testTimeout` generous enough for the live tier (world.ts uses 30s spawn
     and 120s timeouts; quickpickle's default `stepTimeout` is 3000ms — raise it
     in `quickpickle({ stepTimeout: ... })` for `@live` scenarios to pass)

3. **World** — port `GtdWorld` from cucumber `World` to `QuickPickleWorld`
   (`import { setWorldConstructor, QuickPickleWorld } from "quickpickle"`).
   Async setup belongs in `async init()`. All existing methods/fields move over
   unchanged.

4. **Hooks** — port `support/hooks.ts`:
   - `Before`/`After` receive `world` as a parameter instead of `this`; tags
     come from `world.info` (check exact field — it replaces
     `scenario.pickle.tags`). Tier selection logic (`@live` vs default inmem)
     stays identical.
   - **Gotcha:** the cucumber `BeforeAll` runs `npm run build` exactly once per
     run. Under vitest, setupFiles execute once _per worker/test file_, so a
     naive `BeforeAll` port rebuilds 19×. Move the build to a vitest
     `globalSetup` file (or rely on `pretest:e2e` doing the build and drop the
     hook). Only the `@live` tier needs the bundle.

5. **Steps sweep** — mechanical, all 5 `steps/*.steps.ts` files:
   - `import { Given, When, Then } from "@cucumber/cucumber"` →
     `from "quickpickle"`
   - `function (this: GtdWorld, a: string)` → `(world: GtdWorld, a: string)` and
     `this.` → `world.` inside bodies. Uniform pattern, regex-able.
   - DataTable/DocString step args keep working (quickpickle implements the full
     DataTable interface); docstring/table arrives after the expression params,
     same as cucumber.

6. **Tags** — `tags: "not @skip"` from cucumber.mjs is covered by quickpickle's
   default `skipTags: ["@skip"]`. Verify any other tags in the features
   (`grep -rho '@[a-z-]*' tests/integration/features/ | sort -u`) don't collide
   with quickpickle defaults (`@todo/@wip/@fails/@concurrent/@sequential`).
   `@live`/`@inmem` are fine (custom).

7. **Scripts** (`package.json`):
   - `test:e2e` → `vitest run --project e2e` (keep `pretest:e2e` build)
   - `test:unit` → `vitest run --project unit`
   - `test` keeps calling both (or collapses to one `vitest run` + fallow etc.)

8. **Delete** once green: `tests/integration/cucumber.mjs`,
   `tests/integration/support/md-loader.mjs`,
   `tests/integration/support/formatter.ts`, and dev-deps `@cucumber/cucumber`,
   `@cucumber/messages` (check nothing else imports them:
   `grep -rn "@cucumber" src tests dev`). `tsx` may still be used elsewhere
   (`grep` before removing).

9. **README** — update the testing section (`README.md` ~line 626 mentions
   "cucumber integration tests") to describe the vitest/quickpickle setup.
   Significant changes must be reflected in the README (house rule).

## Verification

- `npm run test:e2e` — scenario count matches the recorded baseline, all pass.
- Run a single `@live`-tagged feature to confirm the live tier + timeouts work.
- `npm test` (full gate: format, typecheck, lint, unit, e2e, fallow) passes.
- Confirm parallelism: e2e wall-clock should drop vs. baseline (cucumber was
  capped at `parallel: 4`; vitest spreads 19 feature files across workers). If
  inmem scenarios interfere when parallel (shared process state), pin the
  offenders with `@sequential` rather than disabling the pool.

## Known risks / gotchas

- `world.info` API for tags differs from cucumber's `scenario.pickle` — read
  quickpickle's README/types before porting the `Before` hook.
- Per-worker setup: anything that must run once per test _run_ (the tsup build)
  cannot live in `BeforeAll` under vitest. Use `globalSetup`.
- quickpickle default `stepTimeout` is 3s; live-tier steps spawn a real process
  and need more.
- Small-community dependency (single maintainer). Feature files and step logic
  remain portable back to cucumber-js — both use cucumber expressions and the
  official Gherkin parser — so lock the version and don't build on
  quickpickle-only features beyond tags/config.
- Project conventions in `AGENTS.md` still apply: composable generic `Given`
  steps, setup visible in scenario text, one step ≈ one commit.
