import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { compileTemplate } from "./workflows/templates.js"

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
  it("with no config anywhere: falls back to the built-in default workflow", async () => {
    const cfg = await getConfig()

    // The built-in default is gtd's bundled unified template — same compiled
    // shape and its own `vars:` defaults.
    const { definition, vars } = compileTemplate()
    expect(cfg.workflow).toEqual(definition)
    expect(cfg.workflowVars).toEqual(vars)
    expect(cfg.rcVars).toEqual({})
  })

  it("a config with a top-level `vars:` but no `workflow:` uses the built-in default", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  testCommand: "custom-test"\n`)

    const cfg = await getConfig()

    // No `workflow:` -> built-in default; the top-level `vars:` still loads as
    // the `rcVars` layer that overrides the workflow's own defaults.
    expect(cfg.workflow).toEqual(compileTemplate().definition)
    expect(cfg.rcVars).toEqual({ testCommand: "custom-test" })
  })

  it("layers a top-level `modes:` key over the built-in default's modes", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`modes:`, `  qa:`, `    format: "adr-fmt <%= it.file %>"`, ``].join("\n"),
    )

    const cfg = await getConfig()

    // No `workflow:` -> built-in default, with the rc `modes:` merged in.
    expect(cfg.workflow.states).toEqual(compileTemplate().definition.states)
    expect(cfg.workflow.modes?.qa).toEqual({ format: "adr-fmt <%= it.file %>" })
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
        $schema: "https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json",
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

// A single-state workflow whose `idle` message is a file reference.
const idleMessageRefYaml = (ref: string) =>
  [
    `workflow:`,
    `  states:`,
    `    idle:`,
    `      actor: human`,
    `      initial: true`,
    `      message: "${ref}"`,
    `      on: {}`,
    ``,
  ].join("\n")

// A partial workflow that overlays only `idle.model` — merged over an ancestor
// that supplies the rest of the state (so the ancestor's `message` survives).
const idleModelOverlayYaml = (model: string) =>
  [`workflow:`, `  states:`, `    idle:`, `      model: "${model}"`, ``].join("\n")

describe("ConfigService — content file refs resolve against the declaring config file", () => {
  it("resolves a `./`-relative ref from a .gtdrc stored in an ANCESTOR dir against the ancestor, not the child cwd gtd runs from", async () => {
    // .gtdrc + gtd-prompts/ live in `projectDir`; gtd runs from the child repo
    // `projectDir/repo`, which has NO .gtdrc of its own.
    const repo = join(projectDir, "repo")
    mkdirSync(repo, { recursive: true })
    mkdirSync(join(projectDir, "gtd-prompts"), { recursive: true })
    writeFileSync(join(projectDir, "gtd-prompts", "idle.md"), "idle from the parent dir")
    writeFileSync(join(projectDir, ".gtdrc.yaml"), idleMessageRefYaml("./gtd-prompts/idle.md"))

    const cfg = await getConfig(repo)

    expect(cfg.workflow.states["idle"]?.message).toBe("idle from the parent dir")
  })

  it("resolves an ancestor's surviving ref against the ANCESTOR dir even when a child level overlays the same state", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })
    mkdirSync(join(projectDir, "prompts"), { recursive: true })
    writeFileSync(join(projectDir, "prompts", "idle.md"), "ancestor idle")
    writeFileSync(join(projectDir, ".gtdrc.yaml"), idleMessageRefYaml("./prompts/idle.md"))
    writeFileSync(join(child, ".gtdrc.yaml"), idleModelOverlayYaml("opus-x"))

    const cfg = await getConfig(child)

    // `message` came from the ancestor and inlined against the ancestor dir; the
    // child only overlaid `model`.
    expect(cfg.workflow.states["idle"]?.message).toBe("ancestor idle")
    expect(cfg.workflow.states["idle"]?.model).toBe("opus-x")
  })

  it("resolves a child's overriding ref against the CHILD dir (each level uses its own file), child wins", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })
    mkdirSync(join(projectDir, "prompts"), { recursive: true })
    mkdirSync(join(child, "prompts"), { recursive: true })
    writeFileSync(join(projectDir, "prompts", "idle.md"), "ancestor idle")
    writeFileSync(join(child, "prompts", "idle.md"), "child idle")
    writeFileSync(join(projectDir, ".gtdrc.yaml"), idleMessageRefYaml("./prompts/idle.md"))
    writeFileSync(join(child, ".gtdrc.yaml"), idleMessageRefYaml("./prompts/idle.md"))

    const cfg = await getConfig(child)

    expect(cfg.workflow.states["idle"]?.message).toBe("child idle")
  })

  it("a missing ref in an ancestor .gtdrc fails with an aggregated `workflow config:` error naming the reference", async () => {
    const repo = join(projectDir, "repo")
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(projectDir, ".gtdrc.yaml"), idleMessageRefYaml("./gtd-prompts/missing.md"))

    const exit = await runExit(
      Effect.flatMap(ConfigService, (c) => c.load),
      repo,
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const msg = String(exit.cause)
      expect(msg).toContain("workflow config:")
      expect(msg).toContain('file reference "./gtd-prompts/missing.md" does not exist')
    }
  })

  it("does NOT re-resolve inlined content that itself begins with `./` (no double resolution)", async () => {
    // The referenced file's own text starts with `./` — after inlining it must
    // be kept verbatim, never mistaken for a second file reference.
    mkdirSync(join(projectDir, "prompts"), { recursive: true })
    writeFileSync(join(projectDir, "prompts", "idle.md"), "./configure && make")
    writeFileSync(join(projectDir, ".gtdrc.yaml"), idleMessageRefYaml("./prompts/idle.md"))

    const cfg = await getConfig()

    expect(cfg.workflow.states["idle"]?.message).toBe("./configure && make")
  })
})
