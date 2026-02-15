import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GtdConfigService } from "./Config.js"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gtd-config-service-"))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const runWithDirs = (opts?: {
  cwd?: string
  home?: string
  xdgConfigHome?: string
}) =>
  Effect.gen(function* () {
    return yield* GtdConfigService
  }).pipe(
    Effect.provide(
      GtdConfigService.make({
        cwd: opts?.cwd ?? join(tempDir, "empty-cwd"),
        home: opts?.home ?? join(tempDir, "empty-home"),
        xdgConfigHome: opts?.xdgConfigHome ?? join(tempDir, "empty-xdg"),
      }),
    ),
  )

describe("GtdConfigService (file-based)", () => {
  it("provides all default values when no config files exist", async () => {
    const config = await Effect.runPromise(runWithDirs())
    expect(config.file).toBe("TODO.md")
    expect(config.agent).toBe("auto")
    expect(config.agentPlan).toBe("plan")
    expect(config.agentBuild).toBe("code")
    expect(config.agentLearn).toBe("plan")
    expect(config.testCmd).toBe("npm test")
    expect(config.testRetries).toBe(10)
    expect(config.commitPrompt).toContain("{{diff}}")
    expect(config.agentInactivityTimeout).toBe(300)
    expect(config.agentForbiddenTools).toEqual(["AskUserQuestion"])
  })

  it("reads config from project directory", async () => {
    const cwd = join(tempDir, "project")
    await mkdir(cwd, { recursive: true })
    await writeFile(
      join(cwd, ".gtdrc.json"),
      JSON.stringify({
        file: "PLAN.md",
        agent: "claude",
        testRetries: 5,
        agentForbiddenTools: ["ToolA", "ToolB"],
      }),
    )

    const config = await Effect.runPromise(runWithDirs({ cwd }))
    expect(config.file).toBe("PLAN.md")
    expect(config.agent).toBe("claude")
    expect(config.testRetries).toBe(5)
    expect(config.agentForbiddenTools).toEqual(["ToolA", "ToolB"])
    // defaults still apply for unset keys
    expect(config.agentPlan).toBe("plan")
    expect(config.testCmd).toBe("npm test")
  })

  it("merges configs from multiple locations with correct priority", async () => {
    const cwd = join(tempDir, "project")
    const home = join(tempDir, "home")
    await mkdir(cwd, { recursive: true })
    await mkdir(home, { recursive: true })

    await writeFile(
      join(cwd, ".gtdrc.json"),
      JSON.stringify({ file: "PROJECT.md" }),
    )
    await writeFile(
      join(home, ".gtdrc.json"),
      JSON.stringify({ file: "HOME.md", testCmd: "bun test" }),
    )

    const config = await Effect.runPromise(runWithDirs({ cwd, home }))
    // PWD wins over HOME
    expect(config.file).toBe("PROJECT.md")
    // HOME value used for keys not in PWD
    expect(config.testCmd).toBe("bun test")
  })

  it("GtdConfigService.Live works (uses real process env)", async () => {
    // Just verify it resolves without errors
    const config = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* GtdConfigService
      }).pipe(Effect.provide(GtdConfigService.Live)),
    )
    expect(config.file).toBeDefined()
    expect(config.agent).toBeDefined()
  })
})
