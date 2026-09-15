import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GtdError, Narrator } from "../Commentary.js"
import { ConfigDiscovery, ConfigService, configPresentAt, load } from "./index.js"
import { GitService, Host, Workspace } from "../platform/index.js"
import { compileTemplate } from "../workflows/index.js"
import { seededValidateCommand } from "../SteeringFormats.js"

// Every real port `ConfigService.Live` needs, scoped to `dir` — `home` stays
// the REAL `homedir()` so `walkUp`'s stop condition matches production
// exactly (a test dir under the system tmpdir sits below it, same as a real
// repo would).
const baseLayer = (dir: string) => {
  const hostLayer = Host.layer({ root: dir, home: homedir(), env: {} })
  const gitLayer = GitService.Live.pipe(Layer.provide(Layer.merge(hostLayer, NodeContext.layer)))
  const workspaceLayer = Workspace.Live.pipe(Layer.provide(Layer.merge(hostLayer, gitLayer)))
  return Layer.mergeAll(hostLayer, gitLayer, workspaceLayer)
}

// ConfigService.Live only loads/validates the config — it never writes.
// Narrator is a no-op here, MERGED (not just provided) so it stays in the
// output — these tests assert on the loaded config/failure, not on narration.
const layer = (dir: string) =>
  Layer.mergeAll(
    ConfigService.Live,
    ConfigDiscovery.Live,
    baseLayer(dir),
    Narrator.layer(() => {}, false),
  )

const run = <A>(
  eff: Effect.Effect<A, Error, ConfigService | ConfigDiscovery | Narrator | Workspace | Host>,
  dir: string = projectDir,
) => Effect.runPromise(eff.pipe(Effect.provide(layer(dir))))

const runExit = <A>(
  eff: Effect.Effect<A, Error, ConfigService | ConfigDiscovery | Narrator | Workspace | Host>,
  dir: string = projectDir,
) => Effect.runPromiseExit(eff.pipe(Effect.provide(layer(dir))))

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
    `  entry:`,
    `    default: root`,
    `  machines:`,
    `    root:`,
    `      entry: idle`,
    `      states:`,
    `        idle:`,
    `          actor: human`,
    `          message: "${idleMessage}"`,
    `          on: {}`,
    ``,
  ].join("\n")

describe("ConfigService", () => {
  it("with no config anywhere: falls back to the built-in default workflow", async () => {
    const cfg = await getConfig()

    const { definition, vars } = compileTemplate()
    expect(cfg.workflow).toEqual(definition)
    expect(cfg.workflowVars).toEqual(vars)
    expect(cfg.rcVars).toEqual({})
  })

  it("with no config anywhere: `stateScopes` comes from the built-in default's compiled scopes", async () => {
    const cfg = await getConfig()

    expect(cfg.stateScopes).toEqual(compileTemplate().scopes)
    expect(Object.keys(cfg.stateScopes).sort()).toEqual(Object.keys(cfg.workflow.states).sort())
  })

  it("a custom `workflow:`'s `stateScopes` comes from its own compiled scopes", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), minimalWorkflowYaml("custom idle"))

    const cfg = await getConfig()

    expect(cfg.stateScopes).toEqual({ idle: "" })
  })

  it("a config with a top-level `vars:` but no `workflow:` uses the built-in default", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  testCommand: "custom-test"\n`)

    const cfg = await getConfig()

    // No `workflow:` -> built-in default; the top-level `vars:` still loads
    // into the `rcVars` layer.
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
    expect(cfg.workflow.modes?.qa).toEqual({
      format: "adr-fmt <%= it.file %>",
      validate: seededValidateCommand("qa"),
    })
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
          entry: { default: "root" },
          machines: {
            root: {
              entry: "idle",
              states: {
                idle: { actor: "human", message: "json idle", on: {} },
              },
            },
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
        `  entry:`,
        `    default: root`,
        `  machines:`,
        `    root:`,
        `      entry: idle`,
        `      states:`,
        `        idle: { actor: human, message: "x", on: {} }`,
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

  it("reads a top-level `ui:` key through as-is", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`ui:`, `  port: 4173`, `  host: 0.0.0.0`, ``].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.ui).toEqual({
      port: 4173,
      host: "0.0.0.0",
    })
  })

  it("rejects `ui.loop` and `ui.roots` as excess properties", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`ui:`, `  loop: "gtd next --json"`, ``].join("\n"),
    )

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("merges `ui:` levels low->high: cwd's `port` overlays the ancestor's, cwd wins on overlap", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })

    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`ui:`, `  port: 4173`, `  host: ancestor-host`, ``].join("\n"),
    )
    writeFileSync(join(child, ".gtdrc.yaml"), [`ui:`, `  port: 5000`, ``].join("\n"))

    const cfg = await getConfig(child)

    expect(cfg.ui).toEqual({ port: 5000, host: "ancestor-host" })
  })

  it("rejects an unknown sub-key under a top-level `ui:`, aggregated into one error", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), [`ui:`, `  bogus: true`, ``].join("\n"))

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      // Both halves are load-bearing: the finding itself, AND the absence
      // of the `Schema.optional(Struct)` other-branch's "Expected undefined,
      // actual …" artifact — not a fact about the user's file, dropped by
      // `dropOptionalUndefinedArtifacts`. A loose match on the finding alone
      // would let that noise silently return.
      expect(String(exit.cause)).toContain("gtd config:")
      expect(String(exit.cause)).toContain(
        '"ui.bogus" is unexpected, expected: "port" | "host" | "cert" | "key"',
      )
      expect(String(exit.cause)).not.toContain("Expected undefined")
    }
  })

  it("rejects a wrong-typed `ui:` sub-key with exactly one clause, not the optional-branch's redundant 'Expected undefined' noise", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), [`ui:`, `  port: "nope"`, ``].join("\n"))

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('"ui.port" Expected number, actual "nope"')
      expect(String(exit.cause)).not.toContain("Expected undefined")
    }
  })

  it("rejects the old `serve:` key as an unknown top-level key where the same body under `ui:` decodes", async () => {
    const body = [`  port: 4173`, `  host: 0.0.0.0`, ``].join("\n")
    const configFile = join(projectDir, ".gtdrc.yaml")

    writeFileSync(configFile, `serve:\n${body}`)
    const rejected = await runExit(Effect.flatMap(ConfigService, (c) => c.load))
    expect(Exit.isFailure(rejected)).toBe(true)
    if (Exit.isFailure(rejected)) {
      const error = Cause.squash(rejected.cause)
      expect(error).toBeInstanceOf(GtdError)
      if (error instanceof GtdError) {
        // The unified `<origin>: <path>: <message>` finding format — the
        // offending key and the layer that declared it, in one line.
        expect(error.message).toContain(`${configFile}: serve: `)
        expect(error.message).toMatch(/"serve" is unexpected/)
      }
    }

    writeFileSync(configFile, `ui:\n${body}`)
    const cfg = await getConfig()
    expect(cfg.ui).toEqual({ port: 4173, host: "0.0.0.0" })
  })

  it("merges `vars:` levels low->high: cwd's overlays the ancestor's, cwd wins on overlap", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })

    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `workflow:`,
        `  entry:`,
        `    default: root`,
        `  machines:`,
        `    root:`,
        `      entry: idle`,
        `      states:`,
        `        idle: { actor: human, message: "x", on: {} }`,
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
        `  entry:`,
        `    default: root`,
        `  machines:`,
        `    root:`,
        `      entry: idle`,
        `      states:`,
        `        idle:`,
        `          actor: human`,
        `          message: "hi"`,
        `          file: docs/adr.md`,
        `          mode: adr`,
        `          on: {}`,
        ``,
      ].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.modes).toEqual({
      qa: { validate: seededValidateCommand("qa") },
      review: { validate: seededValidateCommand("review") },
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
        `  entry:`,
        `    default: root`,
        `  machines:`,
        `    root:`,
        `      entry: idle`,
        `      states:`,
        `        idle:`,
        `          actor: human`,
        `          message: "hi"`,
        `          file: docs/adr.md`,
        `          mode: adr`,
        `          on: {}`,
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
        `  entry:`,
        `    default: root`,
        `  machines:`,
        `    root:`,
        `      entry: idle`,
        `      states:`,
        `        idle: { actor: human, message: "x", on: {} }`,
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

  it("rejects an unknown top-level key as an excess property, naming the key and its layer's file", async () => {
    const configFile = join(projectDir, ".gtdrc.yaml")
    writeFileSync(configFile, `testCommand: "npm test"\n`)

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(GtdError)
      if (error instanceof GtdError) {
        // The unified `<origin>: <path>: <message>` finding format, not the
        // old `Invalid gtd config: ...` prose blob with a separate `detail`
        // line — an excess-property rejection is a `Diagnostic` like any
        // other producer's, sorted/deduped the same way.
        expect(error.message).toContain(`${configFile}: testCommand: `)
        expect(error.message).toMatch(/"testCommand" is unexpected/)
      }
    }
  })

  it("names the ANCESTOR layer's file when the offending key came from there, not the cwd's own config", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })
    const ancestorFile = join(projectDir, ".gtdrc.yaml")
    writeFileSync(ancestorFile, `badKey: true\n`)
    writeFileSync(join(child, ".gtdrc.yaml"), `vars:\n  greeting: hi\n`)

    const exit = await runExit(
      Effect.flatMap(ConfigService, (c) => c.load),
      child,
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(GtdError)
      if (error instanceof GtdError) {
        expect(error.message).toContain(`${ancestorFile}: badKey: `)
      }
    }
  })

  it("surfaces the workflow compiler's own error on an invalid `workflow:` key", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `workflow:`,
        `  entry:`,
        `    default: root`,
        `  machines:`,
        `    root:`,
        `      entry: idle`,
        `      states:`,
        `        idle:`,
        `          message: "no actor"`,
        ``,
      ].join("\n"),
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
          entry: { default: "root" },
          machines: {
            root: {
              entry: "idle",
              states: { idle: { actor: "human", message: "x", on: {} } },
            },
          },
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

  it("`load` — the effectful half of the src/workflow/ boundary — is directly usable without going through ConfigService", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), minimalWorkflowYaml("direct load"))

    const result = await run(load, projectDir)

    expect(result.workflow.states["idle"]?.message).toBe("direct load")
  })
})

// A single-state workflow whose `idle` message is a file reference.
const idleMessageRefYaml = (ref: string) =>
  [
    `workflow:`,
    `  entry:`,
    `    default: root`,
    `  machines:`,
    `    root:`,
    `      entry: idle`,
    `      states:`,
    `        idle:`,
    `          actor: human`,
    `          message: "${ref}"`,
    `          on: {}`,
    ``,
  ].join("\n")

// A partial workflow that overlays only `idle.label` — merged over an ancestor
// that supplies the rest of the state (so the ancestor's `message` survives).
const idleLabelOverlayYaml = (label: string) =>
  [
    `workflow:`,
    `  machines:`,
    `    root:`,
    `      states:`,
    `        idle:`,
    `          label: "${label}"`,
    ``,
  ].join("\n")

// A single-machine workflow whose `system:` is a file reference.
const machineSystemRefYaml = (ref: string) =>
  [
    `workflow:`,
    `  entry:`,
    `    default: root`,
    `  machines:`,
    `    root:`,
    `      system: "${ref}"`,
    `      entry: working`,
    `      states:`,
    `        working:`,
    `          actor: agent`,
    `          prompt: "do the thing"`,
    `          on: {}`,
    ``,
  ].join("\n")

// A partial workflow that overlays only `machines.root.system` — merged over
// an ancestor that supplies the rest of the machine (entry + states).
const machineSystemOverlayYaml = (ref: string) =>
  [`workflow:`, `  machines:`, `    root:`, `      system: "${ref}"`, ``].join("\n")

describe("ConfigService — machine-level `system` file refs resolve against the declaring config file", () => {
  it("resolves a child's overriding `system` ref against the CHILD dir (each level uses its own file), child wins", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })
    mkdirSync(join(projectDir, "prompts"), { recursive: true })
    mkdirSync(join(child, "prompts"), { recursive: true })
    writeFileSync(join(projectDir, "prompts", "persona.md"), "ancestor persona")
    writeFileSync(join(child, "prompts", "persona.md"), "child persona")
    writeFileSync(join(projectDir, ".gtdrc.yaml"), machineSystemRefYaml("./prompts/persona.md"))
    writeFileSync(join(child, ".gtdrc.yaml"), machineSystemOverlayYaml("./prompts/persona.md"))

    const cfg = await getConfig(child)

    expect(cfg.workflow.states["working"]?.system).toBe("child persona")
  })
})

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
    writeFileSync(join(child, ".gtdrc.yaml"), idleLabelOverlayYaml("Idle"))

    const cfg = await getConfig(child)

    // `message` came from the ancestor and inlined against the ancestor dir; the
    // child only overlaid `label`.
    expect(cfg.workflow.states["idle"]?.message).toBe("ancestor idle")
    expect(cfg.workflow.states["idle"]?.label).toBe("Idle")
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

  it("a missing ref in an ancestor .gtdrc fails with an aggregated `gtd config:` error naming the reference", async () => {
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
      expect(msg).toContain("gtd config:")
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

describe("ConfigService — malformed level content", () => {
  it("rejects invalid YAML syntax in a .gtdrc.yaml, wrapping the parser's own error", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `workflow: [unterminated\n`)

    await expect(getConfig()).rejects.toThrow(/\.gtdrc\.yaml:/)
  })

  it("rejects invalid JSON syntax in a gtd.config.json, wrapping the parser's own error", async () => {
    writeFileSync(join(projectDir, "gtd.config.json"), `{ "workflow": `)

    await expect(getConfig()).rejects.toThrow(/gtd\.config\.json:/)
  })

  it("rejects a .gtdrc.yaml whose content is the YAML scalar `null`", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `null\n`)

    await expect(getConfig()).rejects.toThrow(/config must be a plain object, got null/)
  })

  it("rejects a gtd.config.json whose content is the JSON literal `null`", async () => {
    writeFileSync(join(projectDir, "gtd.config.json"), `null`)

    await expect(getConfig()).rejects.toThrow(/config must be a plain object, got null/)
  })

  it("rejects a .gtdrc.yaml whose top level is an array, not a plain object", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `- a\n- b\n`)

    await expect(getConfig()).rejects.toThrow(/config must be a plain object, got array/)
  })
})

describe("ConfigService — discovery tolerates the same failure modes cosmiconfig's search does", () => {
  // `ConfigDiscovery.Live` (`src/workflow/discovery.ts`) calls cosmiconfig's
  // own `explorer.search()` directly — this pins that its own internal
  // ENOENT/EISDIR/ENOTDIR/EACCES tolerance still walks past the candidate to
  // the next one, so a directory merely NAMED `.gtdrc` (or an unreadable
  // ancestor) doesn't kill every gtd command with a raw fs error instead of
  // falling through to the built-in default / the next search place.
  it("walks past a `.gtdrc` that is actually a DIRECTORY (EISDIR), instead of failing the whole load", async () => {
    mkdirSync(join(projectDir, ".gtdrc"))

    const cfg = await getConfig()

    expect(cfg.workflow).toEqual(compileTemplate().definition)
  })

  it("still finds a real config in a directory whose OWN first-priority candidate is a directory", async () => {
    mkdirSync(join(projectDir, ".gtdrc"))
    writeFileSync(join(projectDir, ".gtdrc.yaml"), minimalWorkflowYaml("past the directory"))

    const cfg = await getConfig()

    expect(cfg.workflow.states["idle"]?.message).toBe("past the directory")
  })

  it("configPresentAt also walks past a directory-shaped candidate rather than throwing EISDIR", async () => {
    mkdirSync(join(projectDir, ".gtdrc"))

    await expect(
      Effect.runPromise(
        configPresentAt(projectDir).pipe(
          Effect.provide(Layer.mergeAll(baseLayer(projectDir), ConfigDiscovery.Live)),
        ),
      ),
    ).resolves.toBe(false)
  })
})

describe("configPresentAt", () => {
  it("is true when a gtd config lives directly in the given dir", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), minimalWorkflowYaml("x"))

    await expect(
      Effect.runPromise(
        configPresentAt(projectDir).pipe(
          Effect.provide(Layer.mergeAll(baseLayer(projectDir), ConfigDiscovery.Live)),
        ),
      ),
    ).resolves.toBe(true)
  })

  it("is false when no gtd config lives directly in the given dir", async () => {
    await expect(
      Effect.runPromise(
        configPresentAt(projectDir).pipe(
          Effect.provide(Layer.mergeAll(baseLayer(projectDir), ConfigDiscovery.Live)),
        ),
      ),
    ).resolves.toBe(false)
  })

  it("fails when the config at the given dir fails to parse", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `workflow: [unterminated\n`)

    await expect(
      Effect.runPromise(
        configPresentAt(projectDir).pipe(
          Effect.provide(Layer.mergeAll(baseLayer(projectDir), ConfigDiscovery.Live)),
        ),
      ),
    ).rejects.toThrow()
  })
})
