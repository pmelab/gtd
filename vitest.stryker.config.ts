import { defineConfig } from "vitest/config"
import { quickpickle } from "quickpickle"
import { rawMd } from "./tests/vitest.rawMd"
import { SETUP_FILES } from "./tests/integration/support/setup-files.js"

export default defineConfig({
  plugins: [rawMd(), quickpickle({ stepTimeout: 30_000, skipTags: ["@skip", "@live"] })],
  test: {
    include: ["src/**/*.test.ts", "tests/integration/features/**/*.feature"],
    exclude: ["**/*.integration.test.ts"],
    setupFiles: [...SETUP_FILES],
    testTimeout: 300_000,
    hookTimeout: 30_000,
  },
})
