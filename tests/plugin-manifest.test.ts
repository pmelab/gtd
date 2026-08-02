// Manifest sanity checks for the Claude Code plugin under plugins/gtd/ plus
// the repo-root marketplace manifest. These parse the JSON/YAML manifests and
// assert every path they reference actually exists on disk — a cheap guard
// against a typo'd `source`/`hooks`/`command` path that would otherwise only
// surface once someone actually installs the plugin in Claude Code.
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dirname, "..")
const PLUGIN_ROOT = join(REPO_ROOT, "plugins/gtd")

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"))
}

function isExecutable(path: string): boolean {
  // Any of the three executable bits (owner/group/other) — matches how a
  // shell would decide whether it can exec the file directly.
  return (statSync(path).mode & 0o111) !== 0
}

describe("marketplace.json", () => {
  const marketplacePath = join(REPO_ROOT, ".claude-plugin/marketplace.json")

  it("parses and every plugin entry's source resolves to a directory with its own plugin.json", () => {
    const marketplace = readJson(marketplacePath) as { plugins: Array<{ source: string }> }
    expect(Array.isArray(marketplace.plugins)).toBe(true)
    expect(marketplace.plugins.length).toBeGreaterThan(0)

    for (const plugin of marketplace.plugins) {
      const sourceDir = resolve(REPO_ROOT, plugin.source)
      expect(existsSync(sourceDir), `source directory "${plugin.source}" does not exist`).toBe(true)
      expect(statSync(sourceDir).isDirectory()).toBe(true)

      const manifestPath = join(sourceDir, ".claude-plugin/plugin.json")
      expect(existsSync(manifestPath), `"${plugin.source}" has no .claude-plugin/plugin.json`).toBe(
        true,
      )
    }
  })
})

describe("plugins/gtd/.claude-plugin/plugin.json", () => {
  const manifestPath = join(PLUGIN_ROOT, ".claude-plugin/plugin.json")

  it("parses and its hooks path exists", () => {
    const manifest = readJson(manifestPath) as { hooks: string }
    expect(typeof manifest.hooks).toBe("string")
    const hooksPath = resolve(PLUGIN_ROOT, manifest.hooks)
    expect(existsSync(hooksPath), `hooks path "${manifest.hooks}" does not exist`).toBe(true)
  })
})

describe("plugins/gtd/hooks/hooks.json", () => {
  const hooksJsonPath = join(PLUGIN_ROOT, "hooks/hooks.json")

  it("parses and every hook command exists on disk and is executable", () => {
    const hooksConfig = readJson(hooksJsonPath) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }

    const commands: string[] = []
    for (const matchers of Object.values(hooksConfig.hooks)) {
      for (const matcher of matchers) {
        for (const hook of matcher.hooks) {
          commands.push(hook.command)
        }
      }
    }
    expect(commands.length).toBeGreaterThan(0)

    for (const command of commands) {
      const resolvedCommand = command.replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT)
      expect(existsSync(resolvedCommand), `hook command "${command}" does not exist`).toBe(true)
      expect(isExecutable(resolvedCommand), `hook command "${command}" is not executable`).toBe(
        true,
      )
    }
  })
})

// A minimal, line-based frontmatter reader for the leading `---`-delimited
// block every SKILL.md/agent .md file opens with. Deliberately NOT a strict
// YAML parser: several of these `description:` values are long, unquoted
// single-line prose that itself contains ": " (e.g. "in this project:
// statusline, ...") — technically ambiguous per the YAML 1.2 grammar (the
// `yaml` package refuses it as a "nested mapping"), but every real frontmatter
// consumer (Claude Code's own loader included) reads it as plain text. This
// reader mirrors that: a top-level `key:` line starts a field, and any
// following indented/continuation lines (a folded `>-` scalar's body) extend
// the same field's value.
function readFrontmatter(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8")
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content)
  expect(match, `"${path}" has no --- frontmatter block`).not.toBeNull()

  const fields: Record<string, string> = {}
  let currentKey: string | null = null
  for (const line of match![1]!.split("\n")) {
    const topLevel = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line)
    if (topLevel) {
      currentKey = topLevel[1]!
      fields[currentKey] = topLevel[2]!.trim()
    } else if (currentKey && line.trim().length > 0) {
      fields[currentKey] = `${fields[currentKey]} ${line.trim()}`.trim()
    }
  }
  return fields
}

function findFilesMatching(dir: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...findFilesMatching(join(dir, entry.name), predicate))
    } else if (predicate(entry.name)) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

describe("plugins/gtd skills and agents frontmatter", () => {
  const skillFiles = findFilesMatching(join(PLUGIN_ROOT, "skills"), (name) => name === "SKILL.md")
  const agentFiles = findFilesMatching(join(PLUGIN_ROOT, "agents"), (name) => name.endsWith(".md"))

  it("finds at least one skill and one agent to check", () => {
    expect(skillFiles.length).toBeGreaterThan(0)
    expect(agentFiles.length).toBeGreaterThan(0)
  })

  it.each([...skillFiles, ...agentFiles])(
    "%s has frontmatter with name and description",
    (path) => {
      const frontmatter = readFrontmatter(path)
      expect(frontmatter["name"], `"${path}" frontmatter.name`).toBeTruthy()
      // A folded (`>-`) description's key line reads as just the fold
      // indicator, e.g. "description: >-" — that's a real value line, not
      // actual prose, so strip it before checking there's real content.
      const description = (frontmatter["description"] ?? "").replace(/^[|>][-+]?$/, "").trim()
      expect(description.length, `"${path}" frontmatter.description`).toBeGreaterThan(0)
    },
  )
})
