import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { build } from "tsdown"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import tsdownConfigs from "../../tsdown.config.js"

const root = resolve(import.meta.dirname, "../..")
const configs = Array.isArray(tsdownConfigs) ? tsdownConfigs : [tsdownConfigs]
const core = configs.find((config) => config.name === "core")!

let units: readonly string[]
let outDir: string

// The real `core` config, built once more with a source map: it says which
// source file every byte of the bundle came from.
beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "gtd-core-"))
  await build({ ...core, config: false, outDir, clean: false, sourcemap: true, logLevel: "error" })
  const map = JSON.parse(readFileSync(join(outDir, "gtd.core.mjs.map"), "utf8")) as {
    readonly sources: string[]
  }
  units = [
    ...new Set(
      map.sources.flatMap(
        (source) => relative(root, resolve(outDir, source)).match(/^src\/[^/]+\//) ?? [],
      ),
    ),
  ]
}, 60_000)

afterAll(() => rmSync(outDir, { recursive: true, force: true }))

describe("the core bundle", () => {
  it("carries neither ui nor lsp", () => {
    expect(units).not.toContain("src/ui/")
    expect(units).not.toContain("src/lsp/")
  })

  // `gtd judge run` decides verdicts, and verdicts decide the path.
  it("carries the judges", () => {
    expect(units).toContain("src/judges/")
  })
})
