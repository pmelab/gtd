import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"))

// Every file the hooks module reaches, as [file, specifier] import pairs.
const importsFrom = (entry: string, seen = new Set<string>()): [string, string][] => {
  if (seen.has(entry)) return []
  seen.add(entry)
  const specs = [
    ...readFileSync(entry, "utf8").matchAll(/^import\s(?!type\s)[^"]*"([^"]+)"/gm),
  ].map((m) => m[1]!)
  return specs.flatMap((spec) => {
    if (!spec.startsWith(".")) return [[entry, spec] as [string, string]]
    const base = join(dirname(entry), spec).replace(/\.js$/, "")
    const file = [".ts", ".tsx"].map((x) => base + x).find((f) => existsSync(f))
    return file ? importsFrom(file, seen) : []
  })
}

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

  // The engine refuses to load the module otherwise ("a hooks module imports
  // its own files by relative path and \"claude-code\", nothing else").
  it("loads only relative files and claude-code from the hooks module", () => {
    const outside = importsFrom("claude/hooks/register.tsx").filter(([, s]) => s !== "claude-code")
    expect(outside).toEqual([])
  })

  it("installs the plugin from this package", () => {
    const [entry] = json(".claude-plugin/marketplace.json").plugins
    expect(entry.source).toEqual({ source: "npm", package: pkg.name })
    expect(entry.name).toBe(json(".claude-plugin/plugin.json").name)
  })
})
