import { defineConfig } from "vitest/config"
import { quickpickle } from "quickpickle"
import { rawMd } from "./tests/vitest.rawMd"
import { SETUP_FILES } from "./tests/integration/support/setup-files.js"

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
          setupFiles: [...SETUP_FILES],
          testTimeout: 300_000,
        },
      },
      {
        // 60s, not 30s: package 02's driver rewrite reads each field as its
        // own `gtd next --json=<path>`/`gtd land --json=<path>` call rather
        // than one combined `--sh` read — the reference driver now spawns
        // roughly 6x as many real subprocesses per beat. `driver-doc.steps.ts`'s
        // own multi-beat scenarios (e.g. the fix-precheck escalation) run
        // comfortably under 30s in isolation but can cross it under CI's
        // concurrent task load.
        plugins: [rawMd(), quickpickle({ stepTimeout: 60_000, skipTags: ["@skip", "@inmem"] })],
        test: {
          name: "e2e-live",
          pool: "forks",
          // pool:'forks' + fileParallelism:false prevents cross-step IPC
          // stalls in the @live tier (each scenario spawns real git/the gtd
          // bundle) — a constraint the @inmem project no longer pays for.
          fileParallelism: false,
          include: ["tests/integration/features/**/*.feature"],
          setupFiles: [...SETUP_FILES],
          testTimeout: 300_000,
        },
      },
    ],
  },
})
