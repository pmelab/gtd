import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { build } from "tsdown"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import tsdownConfigs from "../../tsdown.config.js"

const root = resolve(import.meta.dirname, "../..")
const configs = Array.isArray(tsdownConfigs) ? tsdownConfigs : [tsdownConfigs]
const entrypoints = configs.find((config) => config.name === "entrypoints")!

let outDir: string

// The real `entrypoints` config, built once more with source maps: they say
// which source file every byte of an entry and its chunks came from.
beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "gtd-entrypoints-"))
  await build({
    ...entrypoints,
    config: false,
    outDir,
    clean: false,
    sourcemap: true,
    logLevel: "error",
  })
}, 60_000)

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

/** Every source file an entry loads: its own file and each chunk it imports, transitively. */
const sourcesOf = (entry: string): ReadonlySet<string> => {
  const files = new Set<string>()
  const visit = (file: string): void => {
    if (files.has(file)) return
    files.add(file)
    const code = readFileSync(file, "utf8")
    for (const [, spec] of code.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) {
      visit(resolve(dirname(file), spec!))
    }
  }
  visit(join(outDir, `${entry}.mjs`))
  const sources = new Set<string>()
  for (const file of files) {
    // A file of bare re-exports or bundler runtime has no source to map.
    if (!existsSync(`${file}.map`)) continue
    const map = JSON.parse(readFileSync(`${file}.map`, "utf8")) as { readonly sources: string[] }
    for (const source of map.sources) sources.add(relative(root, resolve(dirname(file), source)))
  }
  return sources
}

const unitsOf = (entry: string): readonly string[] =>
  [
    ...new Set([...sourcesOf(entry)].flatMap((source) => source.match(/^src\/[^/]+\//) ?? [])),
  ].sort()

describe("package entrypoints", () => {
  for (const unit of ["flows", "wire", "steering"]) {
    it(`the bundled ./${unit} entry contains only src/${unit}/ code`, () => {
      expect(unitsOf(unit)).toEqual([`src/${unit}/`])
    })
  }

  // The check above sees across chunks: an entry built on other units shows them.
  it("the bundled ./workflow-kit entry shows the units it is built on", () => {
    expect(unitsOf("workflow-kit")).toContain("src/flows/")
    expect(unitsOf("workflow-kit").length).toBeGreaterThan(1)
  })
})
