import { execSync } from "node:child_process"
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GtdError, Narrator } from "../Commentary.js"
import { ConfigDiscovery, ConfigService, configPresentAt, load, loadRcConfig } from "./index.js"
import { GitService, Host, Workspace } from "../platform/index.js"
import { seededValidateCommand } from "../SteeringFormats.js"

// Every real port `ConfigService.Live` needs, scoped to `dir` — `home` stays
// the REAL `homedir()` so `walkUp`'s stop condition matches production
// exactly (a test dir under the system tmpdir sits below it, same as a real
// repo would).
type Env = Readonly<Record<string, string>>

const baseLayer = (dir: string, env: Env = {}) => {
  const hostLayer = Host.layer({ root: dir, home: homedir(), env })
  const gitLayer = GitService.Live.pipe(Layer.provide(Layer.merge(hostLayer, NodeContext.layer)))
  const workspaceLayer = Workspace.Live.pipe(Layer.provide(Layer.merge(hostLayer, gitLayer)))
  return Layer.mergeAll(hostLayer, gitLayer, workspaceLayer)
}

// ConfigService.Live only loads/validates the config — it never writes.
// Narrator is a no-op here, MERGED (not just provided) so it stays in the
// output — these tests assert on the loaded config/failure, not on narration.
const layer = (dir: string, env: Env = {}) =>
  Layer.mergeAll(
    ConfigService.Live,
    ConfigDiscovery.Live,
    baseLayer(dir, env),
    Narrator.layer(() => {}, false),
  )

const run = <A>(
  eff: Effect.Effect<A, Error, ConfigService | ConfigDiscovery | Narrator | Workspace | Host>,
  dir: string = projectDir,
  env: Env = {},
) => Effect.runPromise(eff.pipe(Effect.provide(layer(dir, env))))

const runExit = <A>(
  eff: Effect.Effect<A, Error, ConfigService | ConfigDiscovery | Narrator | Workspace | Host>,
  dir: string = projectDir,
) => Effect.runPromiseExit(eff.pipe(Effect.provide(layer(dir))))

const getConfig = (dir?: string, env: Env = {}) =>
  run(
    Effect.flatMap(ConfigService, (c) => c.load),
    dir,
    env,
  )

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "gtd-config-"))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// A one-step workflow whose only step is named `first`.
const minimalWorkflow = (first: string) =>
  [
    `import { human } from "@pmelab/gtd/flows"`,
    ``,
    `export default async () => {`,
    `  await human("${first}")`,
    `}`,
    ``,
  ].join("\n")

describe("ConfigService", () => {
  it("with no config anywhere: falls back to the built-in default workflow", async () => {
    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("idle")
    expect(cfg.defaultWorkflow.env["testCommand"]).toBe("npm test")
    expect(cfg.defaultWorkflow.vars["testCommand"]).toBeUndefined()
    expect(cfg.rcVars).toEqual({})
    expect(cfg.rcEnv).toEqual({})
  })

  it("a config with a top-level `vars:` but no gtd.config.ts uses the built-in default", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  qualityReviews: "a, b"\n`)

    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("idle")
    expect(cfg.rcVars).toEqual({ qualityReviews: "a, b" })
  })

  it("a config with a top-level `env:` lands in rcEnv", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `env:\n  testCommand: "custom-test"\n`)

    const cfg = await getConfig()

    expect(cfg.rcEnv).toEqual({ testCommand: "custom-test" })
    expect(cfg.rcVars).toEqual({})
  })

  it("an environment setting under `vars:` is a load error naming env:", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  testCommand: "custom-test"\n`)

    await expect(getConfig()).rejects.toThrow(
      `"vars.testCommand" is an environment setting — move it under "env:"`,
    )
  })

  it("a process setting under `env:` is a load error naming vars:", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `env:\n  qualityReviews: "a"\n`)

    await expect(getConfig()).rejects.toThrow(
      `"env.qualityReviews" is a process setting — move it under "vars:"`,
    )
  })

  it("a name under both `vars:` and `env:` is an error even when no workflow declares it", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  stray: a\nenv:\n  stray: b\n`)

    await expect(getConfig()).rejects.toThrow(`"stray" is declared under both "vars:" and "env:"`)
  })

  it("a workflow declaring a name in both defaults and envDefaults fails to load", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      `${minimalWorkflow("first")}export const defaults = { x: "1" }\nexport const envDefaults = { x: "2" }\n`,
    )

    await expect(getConfig()).rejects.toThrow(`"x" declared in both "defaults" and "envDefaults"`)
  })

  it("a non-scalar `env:` entry is rejected like under vars:", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `env:\n  bad: [1]\n`)

    await expect(getConfig()).rejects.toThrow(`"env.bad" must be a string, number, or boolean`)
  })

  it("layers `judge:` per field, the inner .gtdrc winning", async () => {
    const inner = join(projectDir, "inner")
    mkdirSync(inner)
    execSync("git init -q", { cwd: inner })
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `judge:\n  provider: jev\n  model: outer\n`)
    writeFileSync(join(inner, ".gtdrc.yaml"), `judge:\n  model: inner\n`)
    const compiled = await run(loadRcConfig, inner)
    expect(compiled.judge).toEqual({ provider: "jev", model: "inner" })
  })

  it("loadRcConfig loads without a repository or gtd.config.ts", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `judge:\n  provider: fixed\n`)
    writeFileSync(join(projectDir, "gtd.config.ts"), `throw new Error("never evaluated")\n`)
    const compiled = await run(loadRcConfig, projectDir)
    expect(compiled.judge).toEqual({ provider: "fixed" })
  })

  it("loadRcConfig fails on any .gtdrc error", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `judge:\n  provider: gpt\n`)
    await expect(run(loadRcConfig, projectDir)).rejects.toThrow(/provider/)
  })

  it("layers a top-level `modes:` key over the built-in modes", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`modes:`, `  qa:`, `    format: "adr-fmt $GTD_FILE"`, ``].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.modes["qa"]).toEqual({
      format: "adr-fmt $GTD_FILE",
      validate: seededValidateCommand("qa"),
    })
  })

  it("reads a custom workflow from gtd.config.ts in cwd", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), minimalWorkflow("custom-idle"))

    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("custom-idle")
  })

  it("reads `defaults`, `summary`, `base` and `steering` off the module and ignores its other exports", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        minimalWorkflow("first"),
        `export const defaults = { greeting: "hi" }`,
        `export const summary = () => "sum"`,
        `export const base = () => undefined`,
        `export const steering = { ".gtd/PLAN.md": "qa" }`,
        `export const helper = 42`,
        ``,
      ].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("first")
    expect(cfg.defaultWorkflow.vars).toEqual({ greeting: "hi" })
    expect(typeof cfg.workflow.summary).toBe("function")
    expect(typeof cfg.workflow.base).toBe("function")
    expect(cfg.workflow.steering).toMatchObject({
      ".gtd/PLAN.md": "qa",
      ".gtd/REVIEW.md": "review",
    })
  })

  it("workflowFiles names gtd.config.ts AND a sibling module it imports from — a caller watching only gtd.config.ts's own path misses that module's edits", async () => {
    writeFileSync(
      join(projectDir, "steps.ts"),
      [`export const steering = { ".gtd/PLAN.md": "qa" }`, ``].join("\n"),
    )
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [minimalWorkflow("first"), `export { steering } from "./steps.js"`, ``].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.steering[".gtd/PLAN.md"]).toBe("qa")
    expect(cfg.workflowFiles.map((f) => realpathSync(f))).toEqual(
      expect.arrayContaining([
        realpathSync(join(projectDir, "gtd.config.ts")),
        realpathSync(join(projectDir, "steps.ts")),
      ]),
    )
  })

  it("workflowFiles is empty for the built-in workflow — no gtd.config.ts backs it", async () => {
    const cfg = await getConfig()

    expect(cfg.workflowFiles).toEqual([])
  })

  it("configFiles names every .gtdrc-family file this load actually found, outermost→innermost", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  greeting: hi\n`)

    const cfg = await getConfig()

    expect(cfg.configFiles.map((f) => realpathSync(f))).toEqual([
      realpathSync(join(projectDir, ".gtdrc.yaml")),
    ])
  })

  it.each([
    [`export const defaults = { n: 1 }`, /"defaults" export is not a record of strings/],
    [`export const summary = "text"`, /"summary" export is not a function/],
    [
      `export const steering = { ".gtd/PLAN.md": 1 }`,
      /"steering" export is not a record of strings/,
    ],
  ])("rejects a malformed named export: %s", async (line, message) => {
    writeFileSync(join(projectDir, "gtd.config.ts"), `${minimalWorkflow("first")}${line}\n`)

    await expect(getConfig()).rejects.toThrow(message)
  })

  const firstStepWorkflow = (body: string) =>
    [
      `import { human, vars, env } from "@pmelab/gtd/flows"`,
      `export default async () => {`,
      `  ${body}`,
      `}`,
      ``,
    ].join("\n")

  it.each([
    [
      "a vars read",
      `await human(vars.route === "x" ? "a" : "b")`,
      'reads the process setting "route"',
    ],
    ["an env read", `await human(env.checker ?? "b")`, 'reads the environment setting "checker"'],
    [
      "several reads, sorted",
      `await human(("z" in vars) || vars.b ? "a" : "b")`,
      'reads the process settings "b", "z"',
    ],
    [
      "an enumeration",
      `await human(Object.keys(vars).length > 0 ? "a" : "b")`,
      "reads every process setting",
    ],
    [
      "an env enumeration",
      `await human(Object.keys(env).length > 0 ? "a" : "b")`,
      "reads every environment setting",
    ],
    [
      "a read only in the message",
      `await human("x", { message: \`m \${vars.route}\` })`,
      'reads the process setting "route"',
    ],
  ])("refuses a first step that depends on a setting: %s", async (_name, body, expected) => {
    writeFileSync(join(projectDir, "gtd.config.ts"), firstStepWorkflow(body))

    await expect(getConfig()).rejects.toThrow(expected)
    await expect(getConfig()).rejects.toThrow(/must not depend on a setting/)
  })

  it("refuses a workflow default whose name is not a valid setting name", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        minimalWorkflow("first"),
        `export const defaults = { "a=b": "1" }`,
        `export const envDefaults = { "c d": "1" }`,
      ].join("\n"),
    )
    await expect(getConfig()).rejects.toThrow(
      'the "defaults" export declares "a=b", not a valid setting name — a setting name is a letter or "_", then letters, digits or "_"',
    )
  })

  it("refuses an envDefaults name that is not a valid setting name", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [minimalWorkflow("first"), `export const envDefaults = { "c d": "1" }`].join("\n"),
    )
    await expect(getConfig()).rejects.toThrow('the "envDefaults" export declares "c d"')
  })

  it("refuses a flow whose first step depends on the repository's files", async () => {
    execSync("git init -q && git config user.email t@t && git config user.name T", {
      cwd: projectDir,
    })
    writeFileSync(join(projectDir, "FIRST.md"), "from-head")
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { human, read } from "@pmelab/gtd/flows"`,
        `export default async () => {`,
        `  await human(read("FIRST.md") ?? "no-file")`,
        `}`,
        ``,
      ].join("\n"),
    )
    execSync("git add -A && git commit -q -m init", { cwd: projectDir })

    await expect(getConfig()).rejects.toThrow(
      /first step on an ordinary start depends on the repository's files \("no-file" without them, "from-head" at HEAD\)/,
    )
  })

  it("accepts a first step that reads the repository for its content only", async () => {
    execSync("git init -q && git config user.email t@t && git config user.name T", {
      cwd: projectDir,
    })
    writeFileSync(join(projectDir, "NOTE.md"), "a note")
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { human, read } from "@pmelab/gtd/flows"`,
        `export default async () => {`,
        `  await human("idle", { message: read("NOTE.md") ?? "" })`,
        `}`,
        ``,
      ].join("\n"),
    )
    execSync("git add -A && git commit -q -m init", { cwd: projectDir })

    expect((await getConfig()).workflow.initial).toBe("idle")
  })

  it("takes the innermost gtd.config.ts — workflows are never merged", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })
    writeFileSync(join(projectDir, "gtd.config.ts"), minimalWorkflow("ancestor-idle"))
    writeFileSync(join(child, "gtd.config.ts"), minimalWorkflow("child-idle"))

    const cfg = await getConfig(child)

    expect(cfg.workflow.initial).toBe("child-idle")
  })

  it("rejects a gtd.config.ts whose default export is not a function", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), `export default { nope: true }\n`)

    await expect(getConfig()).rejects.toThrow(/the default export is not a function/)
  })

  describe("named workflows", () => {
    const flow = (first: string) => `async () => {\n  await human("${first}")\n}`
    const header = `import { human } from "@pmelab/gtd/flows"\n`

    it("with no config: the bundled feature, review and fix are startable, default is not", async () => {
      const cfg = await getConfig()
      expect(cfg.workflowNames).toEqual(["feature", "fix", "review"])
      expect(cfg.defaultWorkflow.name).toBe("feature")
      expect(cfg.workflowNamed("default")).toBeUndefined()
      expect(cfg.workflowNamed("fix")?.def.initial).toBe("idle")
    })

    it("every exported function but the reserved names is a workflow, named by its export", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          header,
          `export default ${flow("main")}`,
          `export const hotfix = ${flow("hot")}`,
          `export const defaults = { greeting: "hi" }`,
          `export const summary = () => "sum"`,
          `export const base = () => undefined`,
          `export const steering = {}`,
          `export const skills = {}`,
          `export const notAFlow = 42`,
          ``,
        ].join("\n"),
      )
      const cfg = await getConfig()
      expect(cfg.workflowNames).toEqual(["feature", "fix", "hotfix", "review"])
      expect(cfg.defaultWorkflow.name).toBe("default")
      expect(cfg.workflow.initial).toBe("main")
      expect(cfg.workflowNamed("hotfix")?.vars).toEqual({ greeting: "hi" })
    })

    it("a repo with only a hotfix export keeps the bundled feature as the default", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [header, `export const hotfix = ${flow("hot")}`, ``].join("\n"),
      )
      const cfg = await getConfig()
      expect(cfg.defaultWorkflow.name).toBe("feature")
      expect(cfg.workflow.initial).toBe("idle")
      expect(cfg.workflowNames).toEqual(["feature", "fix", "hotfix", "review"])
    })

    it("a repo export shadows the bundled one of the same name, and reads its own file's exports", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          header,
          `export const review = ${flow("mine")}`,
          `export const defaults = { greeting: "hi" }`,
          ``,
        ].join("\n"),
      )
      const cfg = await getConfig()
      expect(cfg.workflowNamed("review")?.vars).toEqual({ greeting: "hi" })
      expect(cfg.workflowNamed("fix")?.vars).not.toHaveProperty("greeting")
      expect(cfg.workflowNamed("fix")?.env).toHaveProperty("testCommand")
    })

    it("a helper re-exported from the bundled module becomes a startable workflow", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [`export { unwind } from "@pmelab/gtd/workflow"`, ``].join("\n"),
      )
      expect((await getConfig()).workflowNames).toContain("unwind")
    })

    it("steering is the union of both files, repo winning on a path", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          header,
          `export default ${flow("main")}`,
          `export const steering = { ".gtd/REVIEW.md": "qa", ".gtd/X.md": "qa" }`,
          ``,
        ].join("\n"),
      )
      const steering = (await getConfig()).workflow.steering
      expect(steering[".gtd/REVIEW.md"]).toBe("qa")
      expect(steering[".gtd/X.md"]).toBe("qa")
      expect(steering[".gtd/REQUIREMENTS.md"]).toBe("qa")
    })
  })

  describe("doors", () => {
    const flow = (first: string) => `async () => {\n  await human("${first}")\n}`
    const header = `import { human } from "@pmelab/gtd/flows"\n`
    const withDoors = (doors: string, extra = ""): void =>
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          header,
          `export const hotfix = ${flow("hot")}`,
          extra,
          `export const doors = ${doors}`,
          ``,
        ].join("\n"),
      )

    it("with no config: the bundled fix and review doors, review taking an optional base", async () => {
      const { doors } = await getConfig()
      expect([...doors.keys()].sort()).toEqual(["fix", "review"])
      expect(doors.get("fix")?.workflow).toBe("fix")
      expect(doors.get("review")?.args).toEqual([{ name: "base", optional: true }])
    })

    it("a repo door is added to the bundled ones", async () => {
      withDoors(`{ hot: { workflow: "hotfix", args: [{ name: "ticket" }] } }`)
      const { doors } = await getConfig()
      expect([...doors.keys()].sort()).toEqual(["fix", "hot", "review"])
      expect(doors.get("hot")?.args).toEqual([{ name: "ticket" }])
    })

    it("a repo door wins over a bundled door of the same name", async () => {
      withDoors(`{ review: { workflow: "hotfix" } }`)
      expect((await getConfig()).doors.get("review")?.workflow).toBe("hotfix")
    })

    it("the reserved `doors` export is never a workflow", async () => {
      withDoors(`{}`)
      expect((await getConfig()).workflowNames).toEqual(["feature", "fix", "hotfix", "review"])
    })

    it("rejects a door name that is not lowercase-kebab", async () => {
      withDoors(`{ Bad_Name: { workflow: "fix" } }`)
      await expect(getConfig()).rejects.toThrow(/door "Bad_Name".*\^\[a-z\]\[a-z0-9-\]\*\$/)
    })

    it("rejects a door whose workflow is not in the merged catalogue", async () => {
      withDoors(`{ go: { workflow: "nope" } }`)
      await expect(getConfig()).rejects.toThrow(/door "go".*workflow "nope"/)
    })

    it("rejects a required arg after an optional one", async () => {
      withDoors(`{ go: { workflow: "fix", args: [{ name: "a", optional: true }, { name: "b" }] } }`)
      await expect(getConfig()).rejects.toThrow(/door "go".*"b".*after an optional/)
    })

    it("rejects duplicate arg names", async () => {
      withDoors(`{ go: { workflow: "fix", args: [{ name: "a" }, { name: "a" }] } }`)
      await expect(getConfig()).rejects.toThrow(/door "go".*duplicate arg "a"/)
    })

    it("rejects a `doors` export that is not a record", async () => {
      withDoors(`[1]`)
      await expect(getConfig()).rejects.toThrow(/the "doors" export is not a record/)
    })

    it("rejects a door that is not an object with a workflow name", async () => {
      withDoors(`{ go: 3 }`)
      await expect(getConfig()).rejects.toThrow(/door "go".*workflow/)
    })
  })

  it("loads JSON config (gtd.config.json)", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.json"),
      JSON.stringify({ vars: { greeting: "json" } }),
    )

    const cfg = await getConfig()

    expect(cfg.rcVars).toEqual({ greeting: "json" })
  })

  it("reads a top-level `vars:` key into `rcVars`, coercing scalars to strings", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`vars:`, `  greeting: hi`, `  attempts: 3`, `  strict: true`, ``].join("\n"),
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
      [`vars:`, `  greeting: ancestor`, `  onlyAncestor: yes`, ``].join("\n"),
    )
    writeFileSync(join(child, ".gtdrc.yaml"), [`vars:`, `  greeting: child`, ``].join("\n"))

    const cfg = await getConfig(child)

    expect(cfg.rcVars).toEqual({ greeting: "child", onlyAncestor: "yes" })
  })

  it("lets a top-level `modes:` key define the mode a custom workflow's step names", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`modes:`, `  adr:`, `    validate: "adr-lint $GTD_FILE"`, ``].join("\n"),
    )
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { human } from "@pmelab/gtd/flows"`,
        ``,
        `export default async () => {`,
        `  await human("idle", { message: "hi", file: "docs/adr.md", mode: "adr" })`,
        `}`,
        ``,
      ].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.modes["adr"]).toEqual({ validate: "adr-lint $GTD_FILE" })
  })

  it("rejects a default entry that never reaches a step", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), `export default async () => {}\n`)

    await expect(getConfig()).rejects.toThrow(/the flow returned without reaching any step/)
  })

  it("rejects a malformed top-level `modes:` entry, aggregated into one error", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`modes:`, `  adr:`, `    lint: "adr-lint"`, ``].join("\n"),
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

  it("rejects a `skills:` key that only matches an inherited object property, like `toString`", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `skills:\n  toString: [x]\n`)

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain(
        '"skills.toString" names a step this workflow does not declare',
      )
    }
  })

  it("reports an unknown `skills:` key once per layer that carries it", async () => {
    const child = join(projectDir, "a")
    mkdirSync(child, { recursive: true })
    const ancestorFile = join(projectDir, ".gtdrc.yaml")
    const childFile = join(child, ".gtdrc.yaml")
    writeFileSync(ancestorFile, `skills:\n  no.such.step: [x]\n`)
    writeFileSync(childFile, `skills:\n  no.such.step: [y]\n`)

    const exit = await runExit(
      Effect.flatMap(ConfigService, (c) => c.load),
      child,
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const message = String(Cause.squash(exit.cause))
      expect(message).toContain(`${ancestorFile}: skills.no.such.step: `)
      expect(message).toContain(`${childFile}: skills.no.such.step: `)
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

  it("strip: a config carrying $schema decodes without an excess-property error", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.json"),
      JSON.stringify({
        $schema: "https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json",
        vars: { greeting: "x" },
      }),
    )

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("loading config never writes a file (ConfigService.Live is read-only)", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), minimalWorkflow("x"))

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(existsSync(join(projectDir, ".gtdrc.json"))).toBe(false)
  })

  it("expands a `$NAME` in `vars:` from the environment (host.env, not process.env)", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  model: $BUILD_MODEL\n`)

    const cfg = await getConfig(undefined, { BUILD_MODEL: "smart" })

    expect(cfg.rcVars).toEqual({ model: "smart" })
  })

  it("an unset `$NAME` in `.gtdrc` fails the load naming the config path", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  model: $BUILD_MODEL\n`)

    await expect(getConfig()).rejects.toThrow(/vars\.model.*"\$BUILD_MODEL".*not set/)
  })

  it("keeps `modes.*.format`/`validate` and `ui.format`'s `$GTD_FILE` untouched", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [
        `modes:`,
        `  adr:`,
        `    format: "prettier --write $GTD_FILE"`,
        `    validate: "adr-lint $GTD_FILE"`,
        `ui:`,
        `  format: "oxfmt --write $GTD_FILE"`,
        ``,
      ].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.modes["adr"]).toEqual({
      format: "prettier --write $GTD_FILE",
      validate: "adr-lint $GTD_FILE",
    })
    expect(cfg.ui).toEqual({ format: "oxfmt --write $GTD_FILE" })
  })

  it("an outer layer's unset `$MISSING` still errors even when an inner layer overrides that same value", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  greeting: $MISSING\n`)
    writeFileSync(join(child, ".gtdrc.yaml"), `vars:\n  greeting: overridden\n`)

    await expect(getConfig(child)).rejects.toThrow(/"\$MISSING".*not set/)
  })

  it("never interpolates the workflow's own `defaults` export (it is code, not `.gtdrc`)", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [minimalWorkflow("first"), `export const defaults = { greeting: "$LITERAL" }`, ``].join("\n"),
    )

    const cfg = await getConfig(undefined, { LITERAL: "should-never-appear" })

    expect(cfg.defaultWorkflow.vars).toEqual({ greeting: "$LITERAL" })
  })

  it("`load` — the effectful half of the src/workflow/ boundary — is directly usable without going through ConfigService", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), minimalWorkflow("direct-load"))

    const result = await run(load, projectDir)

    expect(result.workflow.initial).toBe("direct-load")
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

describe("ConfigService — discovery walks past an unreadable candidate", () => {
  // `ConfigDiscovery.Live` (`src/workflow/discovery.ts`) treats ANY read
  // failure — ENOENT/EISDIR/ENOTDIR/EACCES alike — as "not a config file
  // here", so a directory merely NAMED `.gtdrc` (or an unreadable ancestor)
  // doesn't kill every gtd command with a raw fs error instead of falling
  // through to the built-in default / the next search place.
  it("walks past a `.gtdrc` that is actually a DIRECTORY (EISDIR), instead of failing the whole load", async () => {
    mkdirSync(join(projectDir, ".gtdrc"))

    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("idle")
  })

  it("still finds a real config in a directory whose OWN first-priority candidate is a directory", async () => {
    mkdirSync(join(projectDir, ".gtdrc"))
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  greeting: "past the directory"\n`)

    const cfg = await getConfig()

    expect(cfg.rcVars).toEqual({ greeting: "past the directory" })
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
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  greeting: x\n`)

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
