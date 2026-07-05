import { readFileSync } from "node:fs"
import { type Plugin } from "vitest/config"

export const rawMd = (): Plugin => ({
  name: "raw-md",
  transform(_code, id) {
    if (id.endsWith(".md")) {
      const content = readFileSync(id, "utf-8")
      return {
        code: `export default ${JSON.stringify(content)};`,
        map: null,
      }
    }
  },
})
