import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { checkScript, restoreScript } from "./scripts.js"

describe("restoreScript", () => {
  const paths = { restore: ["a.ts"], remove: [] }

  it("restores from <commit>~1 by default", () => {
    expect(restoreScript("abc", paths)).toContain("--source='abc~1'")
  })

  it("restores from the given source commit", () => {
    const script = restoreScript("abc", paths, "def")
    expect(script).toContain("--source='def'")
    expect(script).not.toContain("abc~1")
  })
})

describe("checkScript preamble", () => {
  const options = { report: ".gtd/FEEDBACK.md", stamp: "abc" }
  const runIn = (script: string, dir: string): void => {
    writeFileSync(join(dir, "s.sh"), script)
    spawnSync("sh", ["s.sh"], { cwd: dir })
  }

  it("renders before the command subshell", () => {
    const script = checkScript("npm test", { ...options, preamble: ["echo pre"] })
    expect(script.indexOf("echo pre")).toBeGreaterThan(-1)
    expect(script.indexOf("echo pre")).toBeLessThan(script.indexOf("npm test"))
  })

  it("an exit 0 in the preamble skips the command and leaves report alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-pre-"))
    mkdirSync(join(dir, ".gtd"))
    writeFileSync(join(dir, ".gtd/FEEDBACK.md"), "old")
    runIn(checkScript("touch ran", { ...options, preamble: ["exit 0"] }), dir)
    expect(existsSync(join(dir, "ran"))).toBe(false)
    expect(readFileSync(join(dir, ".gtd/FEEDBACK.md"), "utf8")).toBe("old")
  })
})
