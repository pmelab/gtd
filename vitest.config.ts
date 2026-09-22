import { readFileSync } from "node:fs"
import { defineConfig } from "vitest/config"
import { quickpickle } from "quickpickle"
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import react from "@vitejs/plugin-react"
import { rawMd } from "./tests/vitest.rawMd.js"
import { ensureWebClient } from "./tests/vitest.ensureWebClient.js"
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
        plugins: [rawMd(), ensureWebClient()],
        test: {
          name: "unit",
          // evals/judgments/*.test.ts covers only the pure threshold-sweep
          // math (evals/judgments/metrics.mjs) — the LLM-judge call itself
          // needs GTD_EVALS_URL/GTD_EVALS_KEY and is exercised by
          // `npm run eval:judgments`, deliberately outside `npm test`.
          include: ["src/**/*.test.ts", "tests/tooling/*.test.ts", "evals/judgments/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        plugins: [
          rawMd(),
          ensureWebClient(),
          quickpickle({ stepTimeout: 30_000, skipTags: ["@skip", "@live"] }),
        ],
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
        plugins: [
          rawMd(),
          ensureWebClient(),
          quickpickle({ stepTimeout: 120_000, skipTags: ["@skip", "@inmem"] }),
        ],
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
      {
        // Storybook's vitest addon turns each src/web/**/*.stories.tsx file
        // into vitest test cases, run for real in a headless Chromium via
        // @vitest/browser — vitest already brings vite, so no second
        // bundler enters the repo for this.
        plugins: [react(), storybookTest({ configDir: ".storybook" })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: "playwright",
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
})
