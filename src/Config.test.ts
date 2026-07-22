import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { ConfigInit, ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"

// ConfigService.Live only loads/validates; the auto-init stub write+commit
// lives in ConfigInit. NodeContext.layer satisfies FileSystem + CommandExecutor.
const layer = (dir: string) =>
  Layer.provide(ConfigService.Live, Layer.merge(Cwd.layer(dir), NodeContext.layer))

const ensureInit = (dir: string = projectDir) =>
  Effect.runPromise(
    Effect.flatMap(ConfigInit, (init) => init.ensure).pipe(
      Effect.provide(
        Layer.provide(ConfigInit.Live, Layer.merge(Cwd.layer(dir), NodeContext.layer)),
      ),
    ),
  )

const run = <A>(eff: Effect.Effect<A, Error, ConfigService>, dir: string = projectDir) =>
  Effect.runPromise(eff.pipe(Effect.provide(layer(dir))))

const runExit = <A>(eff: Effect.Effect<A, Error, ConfigService>, dir: string = projectDir) =>
  Effect.runPromiseExit(eff.pipe(Effect.provide(layer(dir))))

const getConfig = (dir?: string) =>
  run(
    Effect.flatMap(ConfigService, (c) => Effect.succeed(c)),
    dir,
  )

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "gtd-config-"))
  // Auto-init writes AND commits `.gtdrc.json`, so the temp dir must be a git
  // repo with a usable identity. Keep the identity repo-local (no global git
  // mutation).
  const git = (...args: Array<string>) =>
    execFileSync("git", args, { cwd: projectDir, stdio: "ignore" })
  git("init")
  git("config", "user.name", "gtd-test")
  git("config", "user.email", "gtd-test@example.com")
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

const minimalWorkflowYaml = (idleMessage: string) =>
  [
    `workflow:`,
    `  states:`,
    `    idle:`,
    `      actor: human`,
    `      initial: true`,
    `      message: "${idleMessage}"`,
    `      on: {}`,
    ``,
  ].join("\n")

describe("ConfigService", () => {
  it("with no config anywhere: the bundled default workflow is active", async () => {
    const cfg = await getConfig()

    expect(cfg.workflow.states["idle"]?.initial).toBe(true)
    expect(cfg.workflow.states["grilling"]).toBeDefined()
    expect(cfg.vars).toBeUndefined()
  })

  it("reads a custom `workflow:` from a single .gtdrc.yaml in cwd", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), minimalWorkflowYaml("custom idle"))

    const cfg = await getConfig()

    expect(cfg.workflow.states["idle"]?.message).toBe("custom idle")
    expect(Object.keys(cfg.workflow.states)).toEqual(["idle"])
  })

  it("merges levels low->high: cwd's `workflow:` overlays the ancestor's, cwd wins on overlap", async () => {
    // Build a chain entirely under tmpdir so the root-stop path is exercised
    // and the user's home dir is never reached.
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })

    writeFileSync(join(projectDir, ".gtdrc.yaml"), minimalWorkflowYaml("ancestor idle"))
    writeFileSync(join(child, ".gtdrc.yaml"), minimalWorkflowYaml("child idle"))

    const cfg = await getConfig(child)

    expect(cfg.workflow.states["idle"]?.message).toBe("child idle") // cwd wins
  })

  it("loads JSON config (gtd.config.json)", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.json"),
      JSON.stringify({
        workflow: {
          states: {
            idle: { actor: "human", initial: true, message: "json idle", on: {} },
          },
        },
      }),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.states["idle"]?.message).toBe("json idle")
  })

  it("rejects an unknown top-level key as an excess property", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `testCommand: "npm test"\n`)

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toMatch(/testCommand/i)
    }
  })

  it("surfaces the workflow compiler's own error on an invalid `workflow:` key", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`workflow:`, `  states:`, `    idle:`, `      message: "no actor, no initial"`, ``].join(
        "\n",
      ),
    )

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toMatch(/initial state|must declare an actor/i)
    }
  })

  it("auto-init: with no config, creates and commits `.gtdrc.json` at the root with the $schema URL", async () => {
    await ensureInit()

    const rcPath = join(projectDir, ".gtdrc.json")
    expect(existsSync(rcPath)).toBe(true)
    const written = JSON.parse(readFileSync(rcPath, "utf8"))
    expect(written.$schema).toBe("https://raw.githubusercontent.com/pmelab/gtd/main/schema.json")
  })

  it("strip: a config carrying $schema decodes without an excess-property error", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.json"),
      JSON.stringify({
        $schema: "https://raw.githubusercontent.com/pmelab/gtd/main/schema.json",
        workflow: {
          states: { idle: { actor: "human", initial: true, message: "x", on: {} } },
        },
      }),
    )

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.workflow.states["idle"]?.message).toBe("x")
    }
  })

  it("idempotency: loading twice succeeds without an `Invalid gtd config` error on excess $schema", async () => {
    // Auto-init the stub first, then load twice.
    await ensureInit()
    const first = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))
    expect(Exit.isSuccess(first)).toBe(true)

    // The `.gtdrc.json` stub now exists and carries $schema; a second load must
    // decode it cleanly rather than fail on the excess property.
    const second = await runExit(Effect.flatMap(ConfigService, (c) => Effect.succeed(c)))
    expect(Exit.isSuccess(second)).toBe(true)
    if (Exit.isFailure(second)) {
      expect(String(second.cause)).not.toMatch(/Invalid gtd config/)
    }
  })
})
