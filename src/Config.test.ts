import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { ConfigService, NO_WORKFLOW_MESSAGE } from "./Config.js"
import { Cwd } from "./Cwd.js"

// ConfigService.Live only loads/validates the config — it never writes.
// NodeContext.layer satisfies FileSystem + CommandExecutor.
const layer = (dir: string) =>
  Layer.provide(ConfigService.Live, Layer.merge(Cwd.layer(dir), NodeContext.layer))

const run = <A>(eff: Effect.Effect<A, Error, ConfigService>, dir: string = projectDir) =>
  Effect.runPromise(eff.pipe(Effect.provide(layer(dir))))

const runExit = <A>(eff: Effect.Effect<A, Error, ConfigService>, dir: string = projectDir) =>
  Effect.runPromiseExit(eff.pipe(Effect.provide(layer(dir))))

const getConfig = (dir?: string) =>
  run(
    Effect.flatMap(ConfigService, (c) => c.load),
    dir,
  )

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "gtd-config-"))
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
  it("with no config anywhere: fails with the `gtd init` hint (there is no default)", async () => {
    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain(NO_WORKFLOW_MESSAGE)
    }
  })

  it("a config with a top-level `vars:` but no `workflow:` still fails with the init hint", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  testCommand: "npm test"\n`)

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain(NO_WORKFLOW_MESSAGE)
    }
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

  it("reads a top-level `vars:` key into `rcVars`, coercing scalars to strings", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `workflow:`,
        `  states:`,
        `    idle: { actor: human, initial: true, message: "x", on: {} }`,
        `vars:`,
        `  greeting: hi`,
        `  attempts: 3`,
        `  strict: true`,
        ``,
      ].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.rcVars).toEqual({ greeting: "hi", attempts: "3", strict: "true" })
  })

  it("merges `vars:` levels low->high: cwd's overlays the ancestor's, cwd wins on overlap", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })

    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `workflow:`,
        `  states:`,
        `    idle: { actor: human, initial: true, message: "x", on: {} }`,
        `vars:`,
        `  greeting: ancestor`,
        `  onlyAncestor: yes`,
        ``,
      ].join("\n"),
    )
    writeFileSync(join(child, ".gtdrc.yaml"), [`vars:`, `  greeting: child`, ``].join("\n"))

    const cfg = await getConfig(child)

    expect(cfg.rcVars).toEqual({ greeting: "child", onlyAncestor: "yes" })
  })

  it("layers a top-level `modes:` key over a CUSTOM workflow's own modes, half by half", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `modes:`,
        `  adr:`,
        `    format: "adr-fmt <%= it.file %>"`,
        `workflow:`,
        `  modes:`,
        `    adr:`,
        `      format: "never-used"`,
        `      validate: "adr-lint <%= it.file %>"`,
        `  states:`,
        `    idle:`,
        `      actor: human`,
        `      initial: true`,
        `      message: "hi"`,
        `      file: docs/adr.md`,
        `      mode: adr`,
        `      on: {}`,
        ``,
      ].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.modes).toEqual({
      adr: { format: "adr-fmt <%= it.file %>", validate: "adr-lint <%= it.file %>" },
    })
  })

  it("lets a top-level `modes:` key define the mode a custom workflow's state names", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `modes:`,
        `  adr:`,
        `    validate: "adr-lint <%= it.file %>"`,
        `workflow:`,
        `  states:`,
        `    idle:`,
        `      actor: human`,
        `      initial: true`,
        `      message: "hi"`,
        `      file: docs/adr.md`,
        `      mode: adr`,
        `      on: {}`,
        ``,
      ].join("\n"),
    )

    // Without the rc layer reaching `validateDefinition`, "adr" would be an
    // unknown mode and this would throw at load time.
    const cfg = await getConfig()

    expect(cfg.workflow.states["idle"]?.mode).toBe("adr")
  })

  it("rejects a malformed top-level `modes:` entry, aggregated into one error", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `modes:`,
        `  adr:`,
        `    lint: "adr-lint"`,
        `workflow:`,
        `  states:`,
        `    idle: { actor: human, initial: true, message: "x", on: {} }`,
        ``,
      ].join("\n"),
    )

    await expect(getConfig()).rejects.toThrow(/mode "adr": unknown key\(s\) lint/)
  })

  it("rejects a non-scalar top-level `vars` entry, aggregated into one error", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`vars:`, `  bad:`, `    nested: true`, ``].join("\n"),
    )

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("gtd config:")
      expect(String(exit.cause)).toContain('"vars.bad" must be a string, number, or boolean')
    }
  })

  it("rejects an unknown top-level key as an excess property", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `testCommand: "npm test"\n`)

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

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

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toMatch(/initial state|must declare an actor/i)
    }
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

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.workflow.states["idle"]?.message).toBe("x")
    }
  })

  it("loading config never writes a file (ConfigService.Live is read-only)", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), minimalWorkflowYaml("x"))

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(existsSync(join(projectDir, ".gtdrc.json"))).toBe(false)
  })
})
