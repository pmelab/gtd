import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import tsdownConfigs from "../../tsdown.config.js"
import { CONFIG_SCAFFOLD } from "../../src/install/index.js"

const root = new URL("../../", import.meta.url).pathname
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  readonly exports: Readonly<Record<string, string | Readonly<Record<string, string>>>>
}

// Every `./dist/<name>.mjs` some tsdown config writes.
const built = new Set(
  (Array.isArray(tsdownConfigs) ? tsdownConfigs : [tsdownConfigs]).flatMap((config) =>
    Object.keys(config.entry as Record<string, string>).map(
      (name) => `./${config.outDir}/${name}.mjs`,
    ),
  ),
)

describe("package.json exports", () => {
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target === "string") continue
    it(`${subpath} serves a build tsdown writes, and its source for types and tests`, () => {
      expect(built).toContain(target.default)
      expect(target.types).toBe(target.source)
      expect(existsSync(join(root, target.source!))).toBe(true)
    })
  }
})

describe("this repository's gtd.config.ts", () => {
  it("is what gtd install scaffolds — it imports the shipped workflows the way users do", () => {
    expect(readFileSync(join(root, "gtd.config.ts"), "utf8")).toBe(CONFIG_SCAFFOLD)
  })
})
