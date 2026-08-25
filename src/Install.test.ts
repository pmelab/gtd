/**
 * `src/Install.ts` is pure string data — these tests pin its two load-bearing
 * properties: `MINIMAL_DRIVER` stays byte-equal to docs/driver.md's own
 * fenced driver block (the single source of truth for both), and
 * `renderBriefing()` names every command/field a driver actually invokes, so
 * a protocol change elsewhere can't silently drift the briefing out of sync.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { MINIMAL_DRIVER, renderBriefing } from "./Install.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

describe("MINIMAL_DRIVER", () => {
  it("equals docs/driver.md's own 'A complete minimal driver' fenced bash block", () => {
    const doc = readFileSync(resolve(import.meta.dirname, "../docs/driver.md"), "utf8")
    const match = doc.match(/### A complete minimal driver\n[\s\S]*?```bash\n([\s\S]*?)\n```/)
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
    expect(briefing).toContain("gtd next --json")
    expect(briefing).toContain("gtd next")
    expect(briefing).toContain("gtd land")
    expect(briefing).not.toContain("gtd status --json")
    expect(briefing).not.toContain("gtd land --json")
    expect(briefing).not.toContain("--dispatch")
    expect(briefing).not.toContain("--if-resting")
    expect(briefing).not.toContain("gtd step")
  })

  it("names the version", () => {
    expect(renderBriefing()).toContain(GTD_VERSION)
  })

  it("instructs the agent to investigate the repo and ask before driving", () => {
    expect(renderBriefing()).toMatch(/investigate the repository and ask/i)
  })

  it("instructs `gtd init`, treating an existing-config refusal as success", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("gtd init")
    expect(briefing).toMatch(/already exists.{0,40}success/is)
    expect(briefing).toMatch(/do not hand-roll/i)
  })

  it("instructs committing the config before the first drive", () => {
    expect(renderBriefing()).toMatch(/commit (it|the config).{0,40}before.{0,20}drive/is)
  })
})
