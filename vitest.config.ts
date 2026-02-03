import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vitest/config"

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
  plugins: [rawMd()],
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts"],
  },
})
