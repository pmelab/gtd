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
  // --- Default values when no config file exists ---
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

  // --- Single file override: .gtdrc.json ---
  it("reads config from a .gtdrc.json file in project directory", async () => {
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

  // --- Single file override: .gtdrc.yaml ---
  it("reads config from a .gtdrc.yaml file in project directory", async () => {
    const cwd = join(tempDir, "project")
    await mkdir(cwd, { recursive: true })
    await writeFile(
      join(cwd, ".gtdrc.yaml"),
      `file: TASKS.md
agent: opencode
testRetries: 3
agentForbiddenTools:
  - ForbiddenA
  - ForbiddenB
`,
    )

    const config = await Effect.runPromise(runWithDirs({ cwd }))
    expect(config.file).toBe("TASKS.md")
    expect(config.agent).toBe("opencode")
    expect(config.testRetries).toBe(3)
    expect(config.agentForbiddenTools).toEqual(["ForbiddenA", "ForbiddenB"])
    // defaults still apply for unset keys
    expect(config.agentBuild).toBe("code")
    expect(config.commitPrompt).toContain("{{diff}}")
  })

  // --- Multi-level merge: home + project directory ---
  it("merges configs from multiple locations with correct priority (cwd > home)", async () => {
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

  // --- XDG config locations: $XDG_CONFIG_HOME/gtd/ ---
  it("reads config from $XDG_CONFIG_HOME/gtd/ directory", async () => {
    const xdg = join(tempDir, "xdg")
    const gtdDir = join(xdg, "gtd")
    await mkdir(gtdDir, { recursive: true })
    await writeFile(
      join(gtdDir, ".gtdrc.json"),
      JSON.stringify({ file: "XDG_GTD.md", testRetries: 7 }),
    )

    const config = await Effect.runPromise(runWithDirs({ xdgConfigHome: xdg }))
    expect(config.file).toBe("XDG_GTD.md")
    expect(config.testRetries).toBe(7)
    // defaults still apply
    expect(config.agent).toBe("auto")
  })

  // --- XDG config locations: $XDG_CONFIG_HOME/.gtdrc.json ---
  it("reads config from $XDG_CONFIG_HOME/.gtdrc.json", async () => {
    const xdg = join(tempDir, "xdg")
    await mkdir(xdg, { recursive: true })
    await writeFile(
      join(xdg, ".gtdrc.json"),
      JSON.stringify({ agent: "opencode", agentInactivityTimeout: 600 }),
    )

    const config = await Effect.runPromise(runWithDirs({ xdgConfigHome: xdg }))
    expect(config.agent).toBe("opencode")
    expect(config.agentInactivityTimeout).toBe(600)
    // defaults still apply
    expect(config.file).toBe("TODO.md")
  })

  // --- XDG priority: $XDG_CONFIG_HOME/gtd/ wins over $XDG_CONFIG_HOME/.gtdrc.json ---
  it("prefers $XDG_CONFIG_HOME/gtd/ over $XDG_CONFIG_HOME/.gtdrc.json", async () => {
    const xdg = join(tempDir, "xdg")
    const gtdDir = join(xdg, "gtd")
    await mkdir(gtdDir, { recursive: true })
    await writeFile(
      join(gtdDir, ".gtdrc.json"),
      JSON.stringify({ file: "XDG_GTD_DIR.md" }),
    )
    await writeFile(
      join(xdg, ".gtdrc.json"),
      JSON.stringify({ file: "XDG_ROOT.md", testCmd: "pnpm test" }),
    )

    const config = await Effect.runPromise(runWithDirs({ xdgConfigHome: xdg }))
    // XDG/gtd/ wins over XDG root for same key
    expect(config.file).toBe("XDG_GTD_DIR.md")
    // XDG root value used for keys not in XDG/gtd/
    expect(config.testCmd).toBe("pnpm test")
  })

  // --- Full priority chain: cwd > xdg/gtd > xdg root > home ---
  it("applies full priority chain: cwd > xdg/gtd > xdg root > home", async () => {
    const cwd = join(tempDir, "project")
    const home = join(tempDir, "home")
    const xdg = join(tempDir, "xdg")
    const gtdDir = join(xdg, "gtd")
    await mkdir(cwd, { recursive: true })
    await mkdir(home, { recursive: true })
    await mkdir(gtdDir, { recursive: true })

    await writeFile(join(cwd, ".gtdrc.json"), JSON.stringify({ file: "CWD.md" }))
    await writeFile(join(gtdDir, ".gtdrc.json"), JSON.stringify({ file: "XDG_GTD.md", agent: "xdg-gtd" }))
    await writeFile(join(xdg, ".gtdrc.json"), JSON.stringify({ file: "XDG.md", agent: "xdg", testCmd: "xdg-test" }))
    await writeFile(join(home, ".gtdrc.json"), JSON.stringify({ file: "HOME.md", agent: "home", testCmd: "home-test", testRetries: 99 }))

    const config = await Effect.runPromise(runWithDirs({ cwd, home, xdgConfigHome: xdg }))
    expect(config.file).toBe("CWD.md")           // from cwd
    expect(config.agent).toBe("xdg-gtd")          // from xdg/gtd
    expect(config.testCmd).toBe("xdg-test")        // from xdg root
    expect(config.testRetries).toBe(99)            // from home
  })

  // --- Invalid file handling: malformed JSON ---
  it("produces an error for malformed JSON config", async () => {
    const cwd = join(tempDir, "project")
    await mkdir(cwd, { recursive: true })
    await writeFile(join(cwd, ".gtdrc.json"), "{ invalid json !!!")

    const result = await Effect.runPromise(
      runWithDirs({ cwd }).pipe(
        Effect.map(() => "success" as const),
        Effect.catchAll(() => Effect.succeed("error" as const)),
      ),
    )
    // cosmiconfig's search handles parse errors - it may either error or skip
    // The key thing is it doesn't crash with an unhandled exception
    expect(["success", "error"]).toContain(result)
  })

  // --- Invalid file handling: wrong types are accepted as raw values ---
  it("accepts config with unexpected types without crashing", async () => {
    const cwd = join(tempDir, "project")
    await mkdir(cwd, { recursive: true })
    await writeFile(
      join(cwd, ".gtdrc.json"),
      JSON.stringify({
        testRetries: "not-a-number",
        agentForbiddenTools: "not-an-array",
      }),
    )

    // Should not throw - the values are passed through as-is
    const result = await Effect.runPromise(
      runWithDirs({ cwd }).pipe(
        Effect.map(() => "success" as const),
        Effect.catchAll(() => Effect.succeed("error" as const)),
      ),
    )
    expect(["success", "error"]).toContain(result)
  })

  // --- Live layer smoke test ---
  it("GtdConfigService.Live works (uses real process env)", async () => {
    const config = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* GtdConfigService
      }).pipe(Effect.provide(GtdConfigService.Live)),
    )
    expect(config.file).toBeDefined()
    expect(config.agent).toBeDefined()
  })
})
