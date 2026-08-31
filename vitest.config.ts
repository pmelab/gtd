import { readFileSync } from "node:fs"
import { defineConfig } from "vitest/config"
import { quickpickle } from "quickpickle"
import { rawMd } from "./tests/vitest.rawMd.js"
import { SETUP_FILES } from "./tests/integration/support/setup-files.js"

// Reuses stryker.config.json's `mutate` array as the coverage `include` list
// so the coverage scope can't drift from the mutation scope.
const strykerConfig = JSON.parse(readFileSync("./stryker.config.json", "utf8"))

export default defineConfig({
  test: {
    reporters: ["./tests/vitest.reporter.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: strykerConfig.mutate,
    },
    projects: [
      {
        plugins: [rawMd()],
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/tooling/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        plugins: [rawMd(), quickpickle({ stepTimeout: 30_000, skipTags: ["@skip", "@live"] })],
        test: {
          name: "e2e-inmem",
          pool: "threads",
          include: ["tests/integration/features/**/*.feature"],
          setupFiles: [...SETUP_FILES],
          testTimeout: 300_000,
        },
      },
      {
        // 120s, not 30s: package 02's driver rewrite reads each field as its
        // own `gtd next --json=<path>`/`gtd land --json=<path>` call rather
        // than one combined `--sh` read — the reference driver now spawns
        // roughly 6x as many real subprocesses per beat. `driver-doc.steps.ts`'s
        // own multi-beat scenarios (e.g. the fix-precheck escalation and the
        // `--resume` fallback) run comfortably under 30s in isolation but
        // crossed 60s under `npm test`'s concurrent turbo task load. Keep this
        // and `driver-doc.steps.ts`'s own execFile timeout equal, and both
        // below `testTimeout`, so a slow step fails as a step, not a test.
        plugins: [rawMd(), quickpickle({ stepTimeout: 120_000, skipTags: ["@skip", "@inmem"] })],
        test: {
          name: "e2e-live",
          pool: "forks",
          // pool:'forks' + the package.json script's `--no-file-parallelism`
          // flag prevents cross-step IPC stalls in the @live tier (each
          // scenario spawns real git/the gtd bundle) — a constraint the
          // @inmem project no longer pays for. `fileParallelism` can no
          // longer live here: vitest resolves it before projects split, so
          // it can only be set root-level (which would also slow down
          // e2e-inmem) or, as here, per npm-script CLI flag.
          include: ["tests/integration/features/**/*.feature"],
          setupFiles: [...SETUP_FILES],
          testTimeout: 300_000,
        },
      },
    ],
  },
})
