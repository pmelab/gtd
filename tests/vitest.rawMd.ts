import { readFileSync } from "node:fs"
import { type Plugin } from "vitest/config"

// Mirrors tsdown.config.ts's `loader: { ".md": "text", ".yaml": "text" }` —
// both extensions must resolve identically in the vitest world (unit + e2e
// tests) as in the built bundle: the bundled default workflow
// (src/workflows/default.yaml) is imported as raw text the same way
// src/prompts/*.md already are.
export const rawMd = (): Plugin => ({
  name: "raw-md",
  transform(_code, id) {
    if (id.endsWith(".md") || id.endsWith(".yaml")) {
      const content = readFileSync(id, "utf-8")
      return {
        code: `export default ${JSON.stringify(content)};`,
        map: null,
      }
    }
  },
})
