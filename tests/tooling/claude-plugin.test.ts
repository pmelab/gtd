import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"))

// The npm package is the Claude Code plugin: these pin what makes it one.
describe("claude plugin", () => {
  const pkg = json("package.json")

  it("releases the plugin manifest in step with the package", () => {
    expect(json(".claude-plugin/plugin.json").version).toBe(pkg.version)
    const release = JSON.stringify(json(".releaserc.json"))
    expect(release).toContain("scripts/sync-plugin-version.mjs")
    expect(release).toContain(".claude-plugin/plugin.json")
  })

  it("publishes every file the plugin loads", () => {
    for (const part of [
      ".claude-plugin/plugin.json",
      "hooks/",
      "bin/",
      "claude/hooks/",
      "claude/types/",
    ]) {
      expect(pkg.files).toContain(part)
    }
    expect(json("hooks/hooks.json").modules).toEqual(["../claude/hooks/register.tsx"])
  })

  it("installs the plugin from this package", () => {
    const [entry] = json(".claude-plugin/marketplace.json").plugins
    expect(entry.source).toEqual({ source: "npm", package: pkg.name })
    expect(entry.name).toBe(json(".claude-plugin/plugin.json").name)
  })
})
