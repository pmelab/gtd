import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect, Schema } from "effect"
import { mkdtemp, writeFile, rm, mkdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveAllConfigs, mergeConfigs, createExampleConfig, SCHEMA_URL, EXAMPLE_CONFIG } from "./ConfigResolver.js"
import { GtdConfigSchema } from "./ConfigSchema.js"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gtd-resolver-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("resolveAllConfigs", () => {
  it("discovers config from PWD search", async () => {
    const projectDir = join(tempDir, "project")
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(projectDir, ".gtdrc.json"),
      JSON.stringify({ file: "PROJECT.md" }),
    )

    const results = await Effect.runPromise(
      resolveAllConfigs({
        cwd: projectDir,
        home: join(tempDir, "fakehome"),
        xdgConfigHome: join(tempDir, "fakexdg"),
      }),
    )

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.config).toEqual({ file: "PROJECT.md" })
  })

  it("discovers config from HOME", async () => {
    const home = join(tempDir, "home")
    await mkdir(home, { recursive: true })
    await writeFile(
      join(home, ".gtdrc.json"),
      JSON.stringify({ agent: "claude" }),
    )

    const results = await Effect.runPromise(
      resolveAllConfigs({
        cwd: join(tempDir, "emptyproject"),
        home,
        xdgConfigHome: join(tempDir, "fakexdg"),
      }),
    )

    expect(results.some((r) => r.config.agent === "claude")).toBe(true)
  })

  it("discovers config from XDG_CONFIG_HOME/gtd/", async () => {
    const xdg = join(tempDir, "xdg")
    const xdgGtd = join(xdg, "gtd")
    await mkdir(xdgGtd, { recursive: true })
    await writeFile(
      join(xdgGtd, ".gtdrc.json"),
      JSON.stringify({ testCmd: "bun test" }),
    )

    const results = await Effect.runPromise(
      resolveAllConfigs({
        cwd: join(tempDir, "emptyproject"),
        home: join(tempDir, "fakehome"),
        xdgConfigHome: xdg,
      }),
    )

    expect(results.some((r) => r.config.testCmd === "bun test")).toBe(true)
  })

  it("discovers config from XDG_CONFIG_HOME/.gtdrc.json", async () => {
    const xdg = join(tempDir, "xdg")
    await mkdir(xdg, { recursive: true })
    await writeFile(
      join(xdg, ".gtdrc.json"),
      JSON.stringify({ testRetries: 7 }),
    )

    const results = await Effect.runPromise(
      resolveAllConfigs({
        cwd: join(tempDir, "emptyproject"),
        home: join(tempDir, "fakehome"),
        xdgConfigHome: xdg,
      }),
    )

    expect(results.some((r) => (r.config as Record<string, unknown>).testRetries === 7)).toBe(true)
  })

  it("returns configs in correct priority order (PWD first, HOME last)", async () => {
    const projectDir = join(tempDir, "project")
    const home = join(tempDir, "home")
    const xdg = join(tempDir, "xdg")
    const xdgGtd = join(xdg, "gtd")

    await mkdir(projectDir, { recursive: true })
    await mkdir(home, { recursive: true })
    await mkdir(xdgGtd, { recursive: true })

    await writeFile(
      join(projectDir, ".gtdrc.json"),
      JSON.stringify({ file: "pwd" }),
    )
    await writeFile(
      join(xdgGtd, ".gtdrc.json"),
      JSON.stringify({ file: "xdg-gtd" }),
    )
    await writeFile(
      join(xdg, ".gtdrc.json"),
      JSON.stringify({ file: "xdg" }),
    )
    await writeFile(
      join(home, ".gtdrc.json"),
      JSON.stringify({ file: "home" }),
    )

    const results = await Effect.runPromise(
      resolveAllConfigs({
        cwd: projectDir,
        home,
        xdgConfigHome: xdg,
      }),
    )

    expect(results.length).toBe(4)
    expect(results[0]!.config.file).toBe("pwd")
    expect(results[1]!.config.file).toBe("xdg-gtd")
    expect(results[2]!.config.file).toBe("xdg")
    expect(results[3]!.config.file).toBe("home")
  })

  it("deduplicates configs found at the same filepath", async () => {
    // When HOME and cosmiconfig search overlap, don't include twice
    const home = join(tempDir, "home")
    await mkdir(home, { recursive: true })
    await writeFile(
      join(home, ".gtdrc.json"),
      JSON.stringify({ agent: "claude" }),
    )

    // Search from home itself - cosmiconfig search will find it, and HOME check will too
    const results = await Effect.runPromise(
      resolveAllConfigs({
        cwd: home,
        home,
        xdgConfigHome: join(tempDir, "fakexdg"),
      }),
    )

    const paths = results.map((r) => r.filepath)
    const unique = new Set(paths)
    expect(paths.length).toBe(unique.size)
  })

  it("returns empty array when no configs exist", async () => {
    const results = await Effect.runPromise(
      resolveAllConfigs({
        cwd: join(tempDir, "nonexistent"),
        home: join(tempDir, "fakehome"),
        xdgConfigHome: join(tempDir, "fakexdg"),
      }),
    )

    expect(results).toEqual([])
  })
})

describe("mergeConfigs", () => {
  it("merges configs with higher priority winning", () => {
    const configs = [
      { config: { file: "PROJECT.md", agent: "claude" } as Record<string, unknown>, filepath: "/a" },
      { config: { file: "HOME.md", testCmd: "bun test" } as Record<string, unknown>, filepath: "/b" },
    ]

    const result = mergeConfigs(configs)

    expect(result.file).toBe("PROJECT.md")
    expect(result.agent).toBe("claude")
    expect(result.testCmd).toBe("bun test")
  })

  it("applies defaults for missing keys", () => {
    const configs = [
      { config: { file: "PLAN.md" } as Record<string, unknown>, filepath: "/a" },
    ]

    const result = mergeConfigs(configs)

    expect(result.file).toBe("PLAN.md")
    expect(result.agent).toBe("auto")
    expect(result.testRetries).toBe(10)
  })

  it("uses all defaults when no configs provided", () => {
    const result = mergeConfigs([])

    expect(result.file).toBe("TODO.md")
    expect(result.agent).toBe("auto")
    expect(result.agentPlan).toBe("plan")
    expect(result.agentBuild).toBe("code")
    expect(result.agentLearn).toBe("plan")
    expect(result.testCmd).toBe("npm test")
    expect(result.testRetries).toBe(10)
    expect(result.commitPrompt).toContain("{{diff}}")
    expect(result.agentInactivityTimeout).toBe(300)
  })

  it("returns source filepaths from all valid configs", () => {
    const configs = [
      { config: { file: "A.md" } as Record<string, unknown>, filepath: "/project/.gtdrc.json" },
      { config: { agent: "claude" } as Record<string, unknown>, filepath: "/home/.gtdrc.json" },
    ]

    const result = mergeConfigs(configs)

    expect(result.configSources).toEqual(["/project/.gtdrc.json", "/home/.gtdrc.json"])
  })

  it("returns empty configSources when no configs provided", () => {
    const result = mergeConfigs([])

    expect(result.configSources).toEqual([])
  })

  it("excludes filepaths of configs that fail validation", () => {
    const configs = [
      { config: { file: "A.md" } as Record<string, unknown>, filepath: "/valid.json" },
      { config: { testRetries: "not-a-number" } as Record<string, unknown>, filepath: "/invalid.json" },
    ]

    const result = mergeConfigs(configs)

    expect(result.configSources).toEqual(["/valid.json"])
  })

  it("higher priority overrides lower for overlapping keys", () => {
    const configs = [
      { config: { agent: "opencode" } as Record<string, unknown>, filepath: "/pwd" },
      { config: { agent: "claude", testCmd: "pytest" } as Record<string, unknown>, filepath: "/home" },
    ]

    const result = mergeConfigs(configs)

    expect(result.agent).toBe("opencode")
    expect(result.testCmd).toBe("pytest")
  })

  it("applies sandbox defaults when fields are omitted", () => {
    const result = mergeConfigs([])

    expect(result.sandboxEnabled).toBe(true)
    expect(result.sandboxBoundaries).toEqual({})
  })

  it("merges sandboxBoundaries from config", () => {
    const configs = [
      {
        config: {
          sandboxBoundaries: {
            filesystem: { allowRead: ["/extra"] },
            network: { allowedDomains: ["custom.com"] },
          },
        } as Record<string, unknown>,
        filepath: "/a",
      },
    ]

    const result = mergeConfigs(configs)

    expect(result.sandboxBoundaries.filesystem?.allowRead).toContain("/extra")
    expect(result.sandboxBoundaries.network?.allowedDomains).toContain("custom.com")
  })

  it("ignores sandboxEscalationPolicy in config for backwards compatibility", () => {
    const configs = [
      { config: { sandboxEscalationPolicy: "prompt" } as Record<string, unknown>, filepath: "/a" },
    ]

    const result = mergeConfigs(configs)

    expect((result as unknown as Record<string, unknown>).sandboxEscalationPolicy).toBeUndefined()
  })

  it("ignores sandboxApprovedEscalations in config for backwards compatibility", () => {
    const configs = [
      {
        config: {
          sandboxApprovedEscalations: [{ from: "restricted", to: "standard" }],
        } as Record<string, unknown>,
        filepath: "/project",
      },
    ]

    const result = mergeConfigs(configs)

    expect((result as unknown as Record<string, unknown>).sandboxApprovedEscalations).toBeUndefined()
  })

  it("higher priority sandboxBoundaries filesystem/network merge with lower", () => {
    const configs = [
      {
        config: {
          sandboxBoundaries: { filesystem: { allowRead: ["/project/extra"] } },
        } as Record<string, unknown>,
        filepath: "/project",
      },
      {
        config: {
          sandboxBoundaries: { filesystem: { allowRead: ["/shared"], allowWrite: ["/shared/out"] } },
        } as Record<string, unknown>,
        filepath: "/user",
      },
    ]

    const result = mergeConfigs(configs)

    expect(result.sandboxBoundaries.filesystem?.allowRead).toContain("/project/extra")
    expect(result.sandboxBoundaries.filesystem?.allowRead).toContain("/shared")
    expect(result.sandboxBoundaries.filesystem?.allowWrite).toEqual(["/shared/out"])
  })

  it("merges filesystem overrides from config", () => {
    const configs = [
      {
        config: {
          sandboxBoundaries: {
            filesystem: { allowRead: ["/shared/libs"], allowWrite: ["/shared/output"] },
          },
        } as Record<string, unknown>,
        filepath: "/a",
      },
    ]

    const result = mergeConfigs(configs)

    expect(result.sandboxBoundaries.filesystem?.allowRead).toEqual(["/shared/libs"])
    expect(result.sandboxBoundaries.filesystem?.allowWrite).toEqual(["/shared/output"])
  })

  it("merges network overrides from config", () => {
    const configs = [
      {
        config: {
          sandboxBoundaries: {
            network: { allowedDomains: ["registry.npmjs.org"] },
          },
        } as Record<string, unknown>,
        filepath: "/a",
      },
    ]

    const result = mergeConfigs(configs)

    expect(result.sandboxBoundaries.network?.allowedDomains).toEqual(["registry.npmjs.org"])
  })

  it("merges filesystem overrides across config levels", () => {
    const configs = [
      {
        config: {
          sandboxBoundaries: { filesystem: { allowRead: ["/project/extra"] } },
        } as Record<string, unknown>,
        filepath: "/project",
      },
      {
        config: {
          sandboxBoundaries: { filesystem: { allowRead: ["/shared/libs"], allowWrite: ["/shared/out"] } },
        } as Record<string, unknown>,
        filepath: "/user",
      },
    ]

    const result = mergeConfigs(configs)

    expect(result.sandboxBoundaries.filesystem?.allowRead).toContain("/project/extra")
    expect(result.sandboxBoundaries.filesystem?.allowRead).toContain("/shared/libs")
    expect(result.sandboxBoundaries.filesystem?.allowWrite).toEqual(["/shared/out"])
  })

  it("merges network overrides across config levels with dedup", () => {
    const configs = [
      {
        config: {
          sandboxBoundaries: { network: { allowedDomains: ["api.example.com", "shared.com"] } },
        } as Record<string, unknown>,
        filepath: "/project",
      },
      {
        config: {
          sandboxBoundaries: { network: { allowedDomains: ["shared.com", "other.com"] } },
        } as Record<string, unknown>,
        filepath: "/user",
      },
    ]

    const result = mergeConfigs(configs)

    expect(result.sandboxBoundaries.network?.allowedDomains).toContain("api.example.com")
    expect(result.sandboxBoundaries.network?.allowedDomains).toContain("shared.com")
    expect(result.sandboxBoundaries.network?.allowedDomains).toContain("other.com")
    const sharedCount = result.sandboxBoundaries.network!.allowedDomains!.filter((d) => d === "shared.com").length
    expect(sharedCount).toBe(1)
  })

  it("defaults produce no filesystem or network overrides", () => {
    const result = mergeConfigs([])

    expect(result.sandboxBoundaries.filesystem).toBeUndefined()
    expect(result.sandboxBoundaries.network).toBeUndefined()
  })
})

describe("createExampleConfig", () => {
  it("writes example config to cwd when no config files exist", async () => {
    const cwd = join(tempDir, "empty-project")
    await mkdir(cwd, { recursive: true })

    const result = await Effect.runPromise(createExampleConfig(cwd))

    expect(result).not.toBeNull()
    expect(result!.filepath).toBe(join(cwd, ".gtdrc.json"))
    const content = await readFile(join(cwd, ".gtdrc.json"), "utf-8")
    const parsed = JSON.parse(content)
    expect(parsed.$schema).toBe(SCHEMA_URL)
    expect(parsed.file).toBeDefined()
    expect(parsed.agent).toBeDefined()
    expect(parsed.testCmd).toBeDefined()
  })

  it("includes $schema URL pointing to GitHub-hosted schema", async () => {
    const cwd = join(tempDir, "schema-test")
    await mkdir(cwd, { recursive: true })

    await Effect.runPromise(createExampleConfig(cwd))

    const content = await readFile(join(cwd, ".gtdrc.json"), "utf-8")
    const parsed = JSON.parse(content)
    expect(parsed.$schema).toMatch(/^https:\/\/raw\.githubusercontent\.com\//)
    expect(parsed.$schema).toContain("schema.json")
  })

  it("includes a _comment field with location hint", async () => {
    const cwd = join(tempDir, "comment-test")
    await mkdir(cwd, { recursive: true })

    await Effect.runPromise(createExampleConfig(cwd))

    const content = await readFile(join(cwd, ".gtdrc.json"), "utf-8")
    const parsed = JSON.parse(content)
    expect(parsed._comment).toBeDefined()
    expect(parsed._comment).toContain("~/.config/gtd/")
  })

  it("returns the filepath and message", async () => {
    const cwd = join(tempDir, "result-test")
    await mkdir(cwd, { recursive: true })

    const result = await Effect.runPromise(createExampleConfig(cwd))

    expect(result).not.toBeNull()
    expect(result!.filepath).toBe(join(cwd, ".gtdrc.json"))
    expect(result!.message).toContain(".gtdrc.json")
    expect(result!.message).toContain("~/.config/gtd/")
  })

  it("EXAMPLE_CONFIG contains all expected default keys", () => {
    expect(EXAMPLE_CONFIG.$schema).toBe(SCHEMA_URL)
    expect(EXAMPLE_CONFIG.file).toBeDefined()
    expect(EXAMPLE_CONFIG.agent).toBeDefined()
    expect(EXAMPLE_CONFIG.testCmd).toBeDefined()
    expect(EXAMPLE_CONFIG.testRetries).toBeDefined()
    expect(EXAMPLE_CONFIG._comment).toBeDefined()
  })

  it("EXAMPLE_CONFIG shows how to extend default sandbox permissions", () => {
    expect(EXAMPLE_CONFIG.sandboxBoundaries).toBeDefined()
    expect(EXAMPLE_CONFIG.sandboxBoundaries.filesystem).toBeDefined()
    expect(EXAMPLE_CONFIG.sandboxBoundaries.filesystem.allowWrite).toContain("/shared/output")
    expect(EXAMPLE_CONFIG.sandboxBoundaries.network).toBeDefined()
    expect(EXAMPLE_CONFIG.sandboxBoundaries.network.allowedDomains).toContain("registry.npmjs.org")
  })

  it("EXAMPLE_CONFIG validates against the schema", () => {
    const { $schema, _comment, ...configOnly } = EXAMPLE_CONFIG
    const result = Schema.decodeUnknownEither(GtdConfigSchema)(configOnly)
    expect(result._tag).toBe("Right")
  })
})
