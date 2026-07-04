import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vitest/config"
import { quickpickle } from "quickpickle"

const rawMd = (): Plugin => ({
  name: "raw-md",
  transform(_code, id) {
    if (id.endsWith(".md")) {
      const content = readFileSync(id, "utf-8")
      return { code: `export default ${JSON.stringify(content)};`, map: null }
    }
  },
})

export default defineConfig({
  test: {
    reporters: ["./tests/vitest.reporter.ts"],
    projects: [
      {
        plugins: [rawMd()],
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        plugins: [rawMd(), quickpickle({ stepTimeout: 30_000 })],
        test: {
          name: "e2e",
          pool: "forks",
          fileParallelism: false,
          include: ["tests/integration/features/**/*.feature"],
          setupFiles: [
            "./tests/integration/support/world.ts",
            "./tests/integration/support/hooks.ts",
            "./tests/integration/support/steps/common.steps.ts",
            "./tests/integration/support/steps/config.steps.ts",
            "./tests/integration/support/steps/environment.steps.ts",
            "./tests/integration/support/steps/formatting.steps.ts",
            "./tests/integration/support/steps/gtd-state.steps.ts",
          ],
          testTimeout: 300_000,
        },
      },
    ],
  },
})
