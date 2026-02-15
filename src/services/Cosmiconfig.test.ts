import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { searchConfig } from "./Cosmiconfig.js"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gtd-cosmiconfig-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("Cosmiconfig integration", () => {
  it("locates a .gtdrc.json in a directory", async () => {
    const config = { file: "PLAN.md", agent: "claude" }
    await writeFile(join(tempDir, ".gtdrc.json"), JSON.stringify(config))

    const result = await Effect.runPromise(searchConfig(tempDir))

    expect(result).not.toBeNull()
    expect(result!.config).toEqual(config)
    expect(result!.filepath).toBe(join(tempDir, ".gtdrc.json"))
  })

  it("locates a .gtdrc.yaml in a directory", async () => {
    const yamlContent = "file: PLAN.md\nagent: opencode\n"
    await writeFile(join(tempDir, ".gtdrc.yaml"), yamlContent)

    const result = await Effect.runPromise(searchConfig(tempDir))

    expect(result).not.toBeNull()
    expect(result!.config).toEqual({ file: "PLAN.md", agent: "opencode" })
    expect(result!.filepath).toBe(join(tempDir, ".gtdrc.yaml"))
  })

  it("locates a .gtdrc.js in a directory", async () => {
    const jsContent = `export default { file: "PLAN.md", testRetries: 5 };`
    await writeFile(join(tempDir, ".gtdrc.js"), jsContent)

    const result = await Effect.runPromise(searchConfig(tempDir))

    expect(result).not.toBeNull()
    expect(result!.config).toEqual({ file: "PLAN.md", testRetries: 5 })
    expect(result!.filepath).toBe(join(tempDir, ".gtdrc.js"))
  })

  it("returns null when no config file exists", async () => {
    const result = await Effect.runPromise(searchConfig(tempDir))
    expect(result).toBeNull()
  })

  it("loads a specific config file path", async () => {
    const subdir = join(tempDir, "sub")
    await mkdir(subdir, { recursive: true })
    const configPath = join(subdir, ".gtdrc.json")
    await writeFile(configPath, JSON.stringify({ agent: "pi" }))

    const { loadConfig } = await import("./Cosmiconfig.js")
    const result = await Effect.runPromise(loadConfig(configPath))

    expect(result).not.toBeNull()
    expect(result!.config).toEqual({ agent: "pi" })
  })
})
