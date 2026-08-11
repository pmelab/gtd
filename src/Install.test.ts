/**
 * `src/Install.ts` is pure string data — these tests pin its two load-bearing
 * properties: `MINIMAL_DRIVER` stays byte-equal to README's own fenced
 * driver block (the single source of truth for both), and `renderBriefing()`
 * names every command/field a driver actually invokes, so a protocol change
 * elsewhere can't silently drift the briefing out of sync.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { MINIMAL_DRIVER, renderBriefing } from "./Install.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

describe("MINIMAL_DRIVER", () => {
  it("equals README's own 'A complete minimal driver' fenced bash block", () => {
    const readme = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8")
    const match = readme.match(/### A complete minimal driver\n[\s\S]*?```bash\n([\s\S]*?)\n```/)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(MINIMAL_DRIVER)
  })
})

describe("renderBriefing", () => {
  it("embeds MINIMAL_DRIVER verbatim", () => {
    expect(renderBriefing()).toContain(MINIMAL_DRIVER)
  })

  it("names every command a driver invokes", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("gtd next --json --dispatch")
    expect(briefing).toContain("gtd status --json")
    expect(briefing).toContain("gtd validate --json")
    expect(briefing).toContain("gtd land --json")
  })

  it("names the version", () => {
    expect(renderBriefing()).toContain(GTD_VERSION)
  })
})
