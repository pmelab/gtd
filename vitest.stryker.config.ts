import { defineConfig } from "vitest/config"
import { quickpickle } from "quickpickle"
import { rawMd } from "./tests/vitest.rawMd"

export default defineConfig({
  plugins: [rawMd(), quickpickle({ stepTimeout: 30_000, skipTags: ["@skip", "@live"] })],
  test: {
    include: ["src/**/*.test.ts", "tests/integration/features/**/*.feature"],
    exclude: ["**/*.integration.test.ts", "src/Perf.test.ts", "src/Machine.property.test.ts"],
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
    hookTimeout: 30_000,
  },
})
