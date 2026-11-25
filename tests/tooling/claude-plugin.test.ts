import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"))

// The npm package is a Claude Code plugin that carries the authoring skill only.
describe("claude plugin", () => {
  const pkg = json("package.json")

  it("releases the plugin manifest in step with the package", () => {
    expect(json(".claude-plugin/plugin.json").version).toBe(pkg.version)
    const release = JSON.stringify(json(".releaserc.json"))
    expect(release).toContain("scripts/sync-plugin-version.mjs")
    expect(release).toContain(".claude-plugin/plugin.json")
  })

  it("publishes the manifest and the authoring skill, and no hooks module", () => {
    for (const part of [".claude-plugin/plugin.json", "bin/", "skills/"]) {
      expect(pkg.files).toContain(part)
    }
    expect(pkg.files.filter((f: string) => /hooks|claude\//.test(f))).toEqual([])
    expect(existsSync("hooks")).toBe(false)
    expect(existsSync("claude")).toBe(false)
    expect(json(".claude-plugin/plugin.json").types).toBeUndefined()
  })

  it("ships the authoring skill", () => {
    expect(readFileSync("skills/authoring/SKILL.md", "utf8")).toMatch(/^name: authoring$/m)
  })

  it("installs the plugin from this package", () => {
    const [entry] = json(".claude-plugin/marketplace.json").plugins
    expect(entry.source).toEqual({ source: "npm", package: pkg.name })
    expect(entry.name).toBe(json(".claude-plugin/plugin.json").name)
  })
})
