import { defineConfig } from "vitest/config"
import { quickpickle } from "quickpickle"
import { rawMd } from "./tests/vitest.rawMd"

export default defineConfig({
  test: {
    reporters: ["./tests/vitest.reporter.ts"],
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
          fileParallelism: true,
          include: ["tests/integration/features/**/*.feature"],
          setupFiles: [
            "./tests/integration/support/world.ts",
            "./tests/integration/support/hooks.ts",
            "./tests/integration/support/steps/common.steps.ts",
            "./tests/integration/support/steps/config.steps.ts",
            "./tests/integration/support/steps/formatting.steps.ts",
            "./tests/integration/support/steps/driver-doc.steps.ts",
            "./tests/integration/support/steps/lsp.steps.ts",
            "./tests/integration/support/steps/review-signoff.steps.ts",
            "./tests/integration/support/steps/review-window.steps.ts",
            "./tests/integration/support/steps/steering.steps.ts",
            "./tests/integration/support/steps/repo-snapshot.steps.ts",
            "./tests/integration/support/steps/signal-exit.steps.ts",
            "./tests/integration/support/steps/tmpdir-gitdir.steps.ts",
          ],
          testTimeout: 300_000,
        },
      },
      {
        plugins: [rawMd(), quickpickle({ stepTimeout: 30_000, skipTags: ["@skip", "@inmem"] })],
        test: {
          name: "e2e-live",
          pool: "forks",
          // pool:'forks' + fileParallelism:false prevents cross-step IPC
          // stalls in the @live tier (each scenario spawns real git/the gtd
          // bundle) — a constraint the @inmem project no longer pays for.
          fileParallelism: false,
          include: ["tests/integration/features/**/*.feature"],
          setupFiles: [
            "./tests/integration/support/world.ts",
            "./tests/integration/support/hooks.ts",
            "./tests/integration/support/steps/common.steps.ts",
            "./tests/integration/support/steps/config.steps.ts",
            "./tests/integration/support/steps/formatting.steps.ts",
            "./tests/integration/support/steps/driver-doc.steps.ts",
            "./tests/integration/support/steps/lsp.steps.ts",
            "./tests/integration/support/steps/review-signoff.steps.ts",
            "./tests/integration/support/steps/review-window.steps.ts",
            "./tests/integration/support/steps/steering.steps.ts",
            "./tests/integration/support/steps/repo-snapshot.steps.ts",
            "./tests/integration/support/steps/signal-exit.steps.ts",
            "./tests/integration/support/steps/tmpdir-gitdir.steps.ts",
          ],
          testTimeout: 300_000,
        },
      },
    ],
  },
})
