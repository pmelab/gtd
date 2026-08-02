import { readFileSync } from "node:fs"
import { type Plugin } from "vitest/config"

// Mirrors tsdown.config.ts's `loader: { ".md": "text", ".yaml": "text",
// ".html": "text" }` — every one of those extensions must resolve identically
// in the vitest world (unit + e2e tests) as in the built bundle: the bundled
// workflow template (src/workflows/unified.yaml) and the visualize page
// (src/visualize.html) are imported as raw text.
export const rawMd = (): Plugin => ({
  name: "raw-md",
  transform(_code, id) {
    if (id.endsWith(".md") || id.endsWith(".yaml") || id.endsWith(".html")) {
      const content = readFileSync(id, "utf-8")
      return {
        code: `export default ${JSON.stringify(content)};`,
        map: null,
      }
    }
  },
})
