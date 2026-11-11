import { defineConfig } from "vitest/config"
import { quickpickle } from "quickpickle"
import { rawMd } from "./tests/vitest.rawMd.js"
import { ensureWebClient } from "./tests/vitest.ensureWebClient.js"
import { isolateGitConfig } from "./tests/vitest.gitConfig.js"
import { SETUP_FILES } from "./tests/integration/support/setup-files.js"

isolateGitConfig()

export default defineConfig({
  plugins: [
    rawMd(),
    ensureWebClient(),
    quickpickle({ stepTimeout: 30_000, skipTags: ["@skip", "@live"] }),
  ],
  test: {
    include: ["src/**/*.test.ts", "tests/integration/features/**/*.feature"],
    exclude: ["**/*.integration.test.ts"],
    setupFiles: [...SETUP_FILES],
    testTimeout: 300_000,
    hookTimeout: 30_000,
  },
})
