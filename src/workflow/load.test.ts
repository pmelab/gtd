import { execSync } from "node:child_process"
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { Narrator, GitService, Host, Workspace } from "../platform/index.js"
import {
  ConfigDiscovery,
  ConfigService,
  load,
  refuseLegacyRc,
  resolveScopeSkills,
  resolveVars,
  seededValidateCommand,
} from "./index.js"
import { CONFIG_SCAFFOLD } from "../install/index.js"

// Every real port `ConfigService.Live` needs, scoped to `dir` — `home` is a
// fresh directory above the project, so the walk stops there as it would in a
// real home, and no rc file of the machine running the suite is ever found.
type Env = Readonly<Record<string, string>>

const baseLayer = (dir: string, env: Env = {}) => {
  const hostLayer = Host.layer({ root: dir, home: homeDir, env })
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

// Config load no longer judges `skills:` keys; the resolver does, given vars.
const loadAndResolve = (dir: string = projectDir, vars: Env = {}) =>
  Effect.gen(function* () {
    const c = yield* (yield* ConfigService).load
    return yield* resolveScopeSkills(c.workflow, {
      ...resolveVars(c.defaultWorkflow.vars, {}, {}),
      ...vars,
    })
  }).pipe(Effect.provide(layer(dir)))

let homeDir: string
let projectDir: string

// Every test starts where `gtd install` leaves a repository.
beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "gtd-config-"))
  projectDir = join(homeDir, "project")
  mkdirSync(projectDir)
  writeFileSync(join(projectDir, "gtd.config.ts"), CONFIG_SCAFFOLD)
})

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true })
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

const withConfig = (config: string) =>
  writeFileSync(
    join(projectDir, "gtd.config.ts"),
    `${CONFIG_SCAFFOLD}\nexport const config = ${config}\n`,
  )

describe("ConfigService", () => {
  it("the scaffolded config runs the shipped feature workflow by default", async () => {
    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("idle")
    expect(cfg.defaultWorkflow.env["testCommand"]).toBe("npm test")
    expect(cfg.defaultWorkflow.vars["testCommand"]).toBeUndefined()
  })

  it("with no gtd.config.ts anywhere: fails, saying to run gtd install", async () => {
    rmSync(join(projectDir, "gtd.config.ts"))

    await expect(getConfig()).rejects.toThrow(
      /no workflows configured: no gtd\.config\.ts here or above — run `gtd install`/,
    )
  })

  it("refuses a leftover .gtdrc, naming the file and where each key went", async () => {
    const file = join(projectDir, ".gtdrc.yaml")
    writeFileSync(file, `env:\n  testCommand: npm test\n`)

    const error = await getConfig().catch((e: Error) => e.message)

    expect(error).toContain(`${file}: no longer read — delete it`)
  })

  it("links a migration anchor docs/configuration.md has a heading for", async () => {
    writeFileSync(join(projectDir, ".gtdrc"), "{}\n")
    const error = await getConfig().then(
      () => "",
      (e: Error) => e.message,
    )
    const anchor = error.match(/docs\/configuration\.md#([\w-]+)/)?.[1]
    const doc = readFileSync(new URL("../../docs/configuration.md", import.meta.url), "utf8")
    const slugs = [...doc.matchAll(/^#+ (.+)$/gm)].map(([, title]) =>
      title!
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-"),
    )
    expect(slugs).toContain(anchor)
  })

  it("only warns about a leftover rc file another user owns", async () => {
    const warnings: string[] = []
    const others = Layer.succeed(ConfigDiscovery, {
      legacyRcFiles: () => Effect.succeed([{ path: "/shared/.gtdrc", owned: false }]),
      workflowModule: () =>
        Effect.succeed({ filepath: join(projectDir, "gtd.config.ts"), source: CONFIG_SCAFFOLD }),
    })
    const cfg = await Effect.runPromise(
      Effect.flatMap(ConfigService, (c) => c.load).pipe(
        Effect.provide(
          Layer.mergeAll(
            ConfigService.Live,
            others,
            baseLayer(projectDir),
            Narrator.layer((m) => warnings.push(m), false),
          ),
        ),
      ),
    )
    expect(cfg.workflow.initial).toBe("idle")
    expect(warnings.join("\n")).toContain(
      "/shared/.gtdrc is a removed .gtdrc file owned by another user",
    )
  })

  it("refuses a user-level rc file in home, even when the walk never reaches home", async () => {
    writeFileSync(join(homeDir, ".gtdrc.json"), `{ "$schema": "x" }\n`)
    const outside = mkdtempSync(join(tmpdir(), "gtd-outside-"))
    writeFileSync(join(outside, "gtd.config.ts"), CONFIG_SCAFFOLD)

    try {
      await expect(getConfig()).rejects.toThrow(`${join(homeDir, ".gtdrc.json")}: no longer read`)
      await expect(getConfig(outside)).rejects.toThrow(
        `${join(homeDir, ".gtdrc.json")}: no longer read`,
      )
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("refuses every rc file found, also without a gtd.config.ts", async () => {
    rmSync(join(projectDir, "gtd.config.ts"))
    writeFileSync(join(projectDir, ".gtdrc"), `{}\n`)
    writeFileSync(join(projectDir, "gtd.config.json"), `{}\n`)

    const error = await getConfig().catch((e: Error) => e.message)

    expect(error).toContain(`${join(projectDir, ".gtdrc")}: no longer read`)
    expect(error).toContain(`${join(projectDir, "gtd.config.json")}: no longer read`)
  })

  it("ignores a directory merely named .gtdrc", async () => {
    mkdirSync(join(projectDir, ".gtdrc"))

    expect((await getConfig()).workflow.initial).toBe("idle")
  })

  it("refuseLegacyRc needs no gtd.config.ts", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), `throw new Error("never evaluated")\n`)
    await expect(run(refuseLegacyRc)).resolves.toBeUndefined()
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `judge:\n  provider: fixed\n`)
    await expect(run(refuseLegacyRc)).rejects.toThrow(/no longer read/)
  })

  it("a workflow declaring a name in both defaults and envDefaults fails to load", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      `${minimalWorkflow("first")}export const defaults = { x: "1" }\nexport const envDefaults = { x: "2" }\n`,
    )

    await expect(getConfig()).rejects.toThrow(`"x" declared in both "defaults" and "envDefaults"`)
  })

  it("layers `config.modes` over the built-in modes, per half", async () => {
    withConfig(`{ modes: { qa: { format: "adr-fmt $GTD_FILE" } } }`)

    const cfg = await getConfig()

    expect(cfg.workflow.modes["qa"]).toEqual({
      format: "adr-fmt $GTD_FILE",
      validate: seededValidateCommand("qa"),
    })
  })

  it("accepts a config built with defineConfig", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { defineConfig } from "@pmelab/gtd/flows"`,
        CONFIG_SCAFFOLD,
        `export const config = defineConfig({ ui: { port: 4173 } })`,
        ``,
      ].join("\n"),
    )

    expect((await getConfig()).ui).toEqual({ port: 4173 })
  })

  it("defineConfig throws on a removed key, failing the load at gtd.config.ts", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { defineConfig } from "@pmelab/gtd/flows"`,
        CONFIG_SCAFFOLD,
        `export const config = defineConfig({ env: { testCommand: "x" } })`,
        ``,
      ].join("\n"),
    )

    await expect(getConfig()).rejects.toThrow("gtd.config.ts: config.env: is not a known key")
  })

  it("rejects an unknown key in a plain `config` object too", async () => {
    withConfig(`{ vars: { greeting: "hi" }, ui: { bogus: true } }`)

    const error = await getConfig().catch((e: Error) => e.message)

    expect(error).toContain("gtd.config.ts: config.ui.bogus: is not a known key")
    expect(error).toContain("gtd.config.ts: config.vars: is not a known key")
  })

  it("the reserved `config` export is never a workflow", async () => {
    withConfig(`{}`)

    expect((await getConfig()).workflowNames).not.toContain("config")
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
    expect(cfg.workflow.steering).toEqual({ ".gtd/PLAN.md": "qa" })
  })

  it("the fingerprint covers gtd.config.ts AND a sibling module it imports from", async () => {
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
    expect(Object.keys(cfg.fingerprint).sort()).toEqual(["gtd.config.ts", "steps.ts"])
  })

  it("the fingerprint covers gtd.config.ts but no shipped module it imports", async () => {
    const cfg = await getConfig()

    expect(Object.keys(cfg.fingerprint)).toEqual(["gtd.config.ts"])
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

    it("the scaffolded config: feature, review and fix are startable, default is not", async () => {
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
      expect(cfg.workflowNames).toEqual(["hotfix"])
      expect(cfg.defaultWorkflow.name).toBe("default")
      expect(cfg.workflow.initial).toBe("main")
      expect(cfg.workflowNamed("hotfix")?.vars).toEqual({ greeting: "hi" })
    })

    it("a config with no default export fails, saying what to export", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [header, `export const hotfix = ${flow("hot")}`, ``].join("\n"),
      )
      await expect(getConfig()).rejects.toThrow(/no default export.*`gtd install`/)
    })

    it("a default that is also a named export goes by that name", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [header, `export const hotfix = ${flow("hot")}`, `export default hotfix`, ``].join("\n"),
      )
      expect((await getConfig()).defaultWorkflow.name).toBe("hotfix")
    })

    it("a helper re-exported from the shipped module becomes a startable workflow", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [`export { feature as default, unwind } from "@pmelab/gtd/workflows"`, ``].join("\n"),
      )
      expect((await getConfig()).workflowNames).toContain("unwind")
    })

    it("the old @pmelab/gtd/workflow subpath serves the same module", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [`export { feature as default, feature } from "@pmelab/gtd/workflow"`, ``].join("\n"),
      )
      expect((await getConfig()).defaultWorkflow.name).toBe("feature")
    })

    it("each shipped workflow has its own subpath", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          `export { feature as default, feature } from "@pmelab/gtd/workflows/feature"`,
          `export { review } from "@pmelab/gtd/workflows/review"`,
          `export { fix } from "@pmelab/gtd/workflows/fix"`,
          ``,
        ].join("\n"),
      )
      const config = await getConfig()
      expect(config.defaultWorkflow.name).toBe("feature")
      expect(config.workflowNames).toEqual(["feature", "fix", "review"])
    })

    it("a shipped subpath only a helper file imports resolves", async () => {
      writeFileSync(
        join(projectDir, "kit.ts"),
        [
          `import { lensesOf } from "@pmelab/gtd/workflow-kit"`,
          `export const kit = typeof lensesOf`,
          ``,
        ].join("\n"),
      )
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          header,
          `import { kit } from "./kit"`,
          `export default ${flow("main")}`,
          'export const steering = { [`.gtd/${kit}.md`]: "qa" }',
          ``,
        ].join("\n"),
      )
      expect((await getConfig()).workflow.steering[".gtd/function.md"]).toBe("qa")
    })

    it("steering is the config's own export", async () => {
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
      expect(steering[".gtd/REQUIREMENTS.md"]).toBeUndefined()
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
          `export default ${flow("main")}`,
          `export const hotfix = ${flow("hot")}`,
          extra,
          `export const doors = ${doors}`,
          ``,
        ].join("\n"),
      )

    it("the scaffolded config: the fix and review doors, review taking an optional base", async () => {
      const { doors } = await getConfig()
      expect([...doors.keys()].sort()).toEqual(["fix", "review"])
      expect(doors.get("fix")?.workflow).toBe("fix")
      expect(doors.get("review")?.args).toEqual([{ name: "base", optional: true }])
    })

    it("a config exporting only fix gets only fix's door", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          header,
          `export default ${flow("main")}`,
          `export { fix } from "@pmelab/gtd/workflows"`,
          ``,
        ].join("\n"),
      )
      const { doors } = await getConfig()
      expect([...doors.keys()]).toEqual(["fix"])
    })

    it("a door follows the name its workflow is exported under", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        `export { feature as default, review as audit } from "@pmelab/gtd/workflows"\n`,
      )
      const door = (await getConfig()).doors.get("review")
      expect(door?.workflow).toBe("audit")
      expect(door?.vars?.({ base: "main" })).toEqual({ reviewBase: "main" })
    })

    it("a review factory exported as audit reviews the default branch, or an explicit base", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        `export { feature as default, review as audit } from "@pmelab/gtd/workflows"\n`,
      )
      const audit = (await getConfig()).workflowNamed("audit")
      expect(audit?.def.base?.("audit", {})).toBe("")
      expect(audit?.def.base?.("audit", { reviewBase: "v1" })).toBe("v1")
    })

    it("a config's own base export wins over the review factory's", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          `export { feature as default, review } from "@pmelab/gtd/workflows"`,
          `export const base = (w: string) => (w === "review" ? "develop" : undefined)`,
          ``,
        ].join("\n"),
      )
      expect((await getConfig()).workflowNamed("review")?.def.base?.("review", {})).toBe("develop")
    })

    it("a door several workflows build gets no door when none is exported under its name, until the doors export declares it", async () => {
      const both = `export { feature as default, fix as fix2, fix as fix3 } from "@pmelab/gtd/workflows"`
      writeFileSync(join(projectDir, "gtd.config.ts"), `${both}\n`)
      expect((await getConfig()).doors.get("fix")).toBeUndefined()
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        `${both}\nexport const doors = { fix: { workflow: "fix3" } }\n`,
      )
      expect((await getConfig()).doors.get("fix")?.workflow).toBe("fix3")
    })

    it("a door clash warns once at doors.<name>, builders sorted", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        `export { feature as default, fix as fix3, fix as fix4, fix as fix2 } from "@pmelab/gtd/workflows"\n`,
      )
      const cfg = await getConfig()
      const clash = cfg.warnings.filter((w) => w.path[0] === "doors")
      expect(clash).toEqual([
        {
          severity: "warning",
          path: ["doors", "fix"],
          origin: join(projectDir, "gtd.config.ts"),
          message: `door "fix" is built by workflows "fix2", "fix3" and "fix4" and none is exported under that name — declare it in the "doors" export`,
        },
      ])
    })

    it("no clash warning when an export is named after the door, one workflow builds it, or doors declares it", async () => {
      const both = `export { feature as default, fix as fix2, fix as fix3 } from "@pmelab/gtd/workflows"`
      for (const body of [
        `export { feature as default, fix as fix2, fix } from "@pmelab/gtd/workflows"\n`,
        `export { feature as default, fix } from "@pmelab/gtd/workflows"\n`,
        `${both}\nexport const doors = { fix: { workflow: "fix3" } }\n`,
      ]) {
        writeFileSync(join(projectDir, "gtd.config.ts"), body)
        expect((await getConfig()).warnings.filter((w) => w.path[0] === "doors")).toEqual([])
      }
    })

    it("door ownership does not depend on export order", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        `export { feature as default, fix as fix2, fix } from "@pmelab/gtd/workflows"\n`,
      )
      expect((await getConfig()).doors.get("fix")?.workflow).toBe("fix")
    })

    it("rollout and a second instance of it load, door rollout running workflow rollout whichever export comes first", async () => {
      for (const body of [
        `export { rollout } from "@pmelab/gtd/workflows"\nimport { rollout } from "@pmelab/gtd/workflows"\nexport const elsewhere = rollout({ flagRegistry: "x.ts" })`,
        `import { rollout } from "@pmelab/gtd/workflows"\nexport const elsewhere = rollout({ flagRegistry: "x.ts" })\nexport { rollout }`,
      ]) {
        writeFileSync(
          join(projectDir, "gtd.config.ts"),
          `export { feature as default } from "@pmelab/gtd/workflows"\n${body}\n`,
        )
        expect((await getConfig()).doors.get("rollout")?.workflow).toBe("rollout")
      }
    })

    it("shipped rollout and cleanup list their doors beside fix and review", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        `export { feature as default, fix, review, rollout, cleanup } from "@pmelab/gtd/workflows"\n`,
      )
      const { doors } = await getConfig()
      expect([...doors.keys()]).toEqual(["cleanup", "fix", "review", "rollout"])
      expect(doors.get("rollout")?.args).toEqual([{ name: "flag" }])
      expect(doors.get("cleanup")?.args).toEqual([{ name: "flag" }])
    })

    it("rollout and cleanup load from their own subpaths", async () => {
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        [
          `export { feature as default, fix, review } from "@pmelab/gtd/workflows"`,
          `export { rollout } from "@pmelab/gtd/workflows/rollout"`,
          `export { cleanup } from "@pmelab/gtd/workflows/cleanup"`,
          ``,
        ].join("\n"),
      )
      const { doors } = await getConfig()
      expect([...doors.keys()]).toEqual(["cleanup", "fix", "review", "rollout"])
      expect(doors.get("rollout")?.args).toEqual([{ name: "flag" }])
      expect(doors.get("cleanup")?.args).toEqual([{ name: "flag" }])
    })

    it("a config's doors merge derived doors (exported workflows) with declared doors (doors export)", async () => {
      withDoors(
        `{ hot: { workflow: "hotfix", args: [{ name: "ticket" }] } }`,
        'export { fix } from "@pmelab/gtd/workflows"',
      )
      const { doors } = await getConfig()
      expect([...doors.keys()].sort()).toEqual(["fix", "hot"])
      expect(doors.get("fix")).toBeDefined()
      expect(doors.get("hot")?.workflow).toBe("hotfix")
      expect(doors.get("hot")?.args).toEqual([{ name: "ticket" }])
    })

    it("the reserved `doors` export is never a workflow", async () => {
      withDoors(`{}`)
      expect((await getConfig()).workflowNames).toEqual(["hotfix"])
    })

    it("rejects a door name that is not lowercase-kebab", async () => {
      withDoors(`{ Bad_Name: { workflow: "fix" } }`)
      await expect(getConfig()).rejects.toThrow(/door "Bad_Name".*\^\[a-z\]\[a-z0-9-\]\*\$/)
    })

    it("rejects a door whose workflow is not startable", async () => {
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

  it("reads `config.ui` through as-is", async () => {
    withConfig(`{ ui: { port: 4173, host: "0.0.0.0" } }`)

    expect((await getConfig()).ui).toEqual({ port: 4173, host: "0.0.0.0" })
  })

  it("rejects a wrong-typed `config.ui` key", async () => {
    withConfig(`{ ui: { port: "nope" } }`)

    await expect(getConfig()).rejects.toThrow("config.ui.port: must be an integer")
  })

  it("lets `config.modes` define the mode a custom workflow's step names", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { human } from "@pmelab/gtd/flows"`,
        ``,
        `export default async () => {`,
        `  await human("idle", { message: "hi", file: "docs/adr.md", mode: "adr" })`,
        `}`,
        `export const config = { modes: { adr: { validate: "adr-lint $GTD_FILE" } } }`,
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

  it("rejects a malformed `config.modes` entry", async () => {
    withConfig(`{ modes: { adr: { lint: "adr-lint" } } }`)

    await expect(getConfig()).rejects.toThrow("config.modes.adr.lint: is not a known key")
  })

  it("rejects a `config.skills` key that only matches an inherited object property, like `toString`", async () => {
    withConfig(`{ skills: { toString: ["x"] } }`)

    const exit = await Effect.runPromiseExit(loadAndResolve())

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('"skills.toString" is not a scope that runs a turn')
    }
  })

  describe("`config.skills` keys are scope names", () => {
    const loadError = async (config: string): Promise<string> => {
      withConfig(config)
      const exit = await Effect.runPromiseExit(loadAndResolve())
      expect(Exit.isFailure(exit)).toBe(true)
      return Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : ""
    }
    const keyed = (key: string): string => `{ skills: { "${key}": ["x"] } }`

    it("names the key and lists every known scope", async () => {
      const message = await loadError(keyed("nope"))
      expect(message).toContain('"skills.nope" is not a scope that runs a turn — known scopes: ')
      expect(message).toContain("architecture, architecture.decompose, build,")
    })

    it("gives a group key the same plain error", async () => {
      expect(await loadError(keyed("build.fix"))).toContain("known scopes: ")
    })

    it("accepts a scope key and keeps it in configuredSkills", async () => {
      withConfig(keyed("build.review"))
      expect((await getConfig()).workflow.configuredSkills).toEqual({ "build.review": ["x"] })
    })

    it("validates a lens key only while the lens is in qualityReviews", async () => {
      withConfig(keyed("build.quality.my-lens"))
      expect((await getConfig()).workflow.configuredSkills).toEqual({
        "build.quality.my-lens": ["x"],
      })
      const withLens = await Effect.runPromise(
        loadAndResolve(projectDir, { qualityReviews: "my-lens" }),
      )
      expect(Object.keys(withLens)).toContain("build.quality.my-lens")
      expect(await loadError(keyed("build.quality.my-lens"))).toContain(
        '"skills.build.quality.my-lens" is not a scope that runs a turn',
      )
    })

    it("loads a skills export given as a record or as a function of the vars", async () => {
      const flow = minimalWorkflow("first")
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        `${flow}export const skills = { a: ["x"] }\n`,
      )
      expect(Object.keys((await getConfig()).workflow.skills({}))).toEqual(["a"])
      writeFileSync(
        join(projectDir, "gtd.config.ts"),
        `${flow}export const skills = (vars) => ({ [vars.k ?? "none"]: ["x"] })\n`,
      )
      expect(Object.keys((await getConfig()).workflow.skills({ k: "b" }))).toEqual(["b"])
    })
  })

  it("loading config never writes a file (ConfigService.Live is read-only)", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), minimalWorkflow("x"))

    const exit = await runExit(Effect.flatMap(ConfigService, (c) => c.load))

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(existsSync(join(projectDir, ".gtd"))).toBe(false)
  })

  it("keeps `modes.*.format`/`validate` and `ui.format`'s `$GTD_FILE` untouched", async () => {
    withConfig(
      `{ modes: { adr: { format: "prettier --write $GTD_FILE", validate: "adr-lint $GTD_FILE" } }, ui: { format: "oxfmt --write $GTD_FILE" } }`,
    )

    const cfg = await getConfig(undefined, { GTD_FILE: "should-never-appear" })

    expect(cfg.workflow.modes["adr"]).toEqual({
      format: "prettier --write $GTD_FILE",
      validate: "adr-lint $GTD_FILE",
    })
    expect(cfg.ui).toEqual({ format: "oxfmt --write $GTD_FILE" })
  })

  it("never interpolates the workflow's own `defaults` export", async () => {
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

describe("ConfigService — workflow factory options", () => {
  const configWith = (body: string) =>
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [`import { feature, fix, review } from "@pmelab/gtd/workflows"`, body, ``].join("\n"),
    )

  it("an option given in gtd.config.ts becomes the workflow's setting of its kind", async () => {
    configWith(
      `export default feature({ qualityReviews: "correctness", testCommand: "npm run ci" })`,
    )

    const cfg = await getConfig()

    expect(cfg.defaultWorkflow.name).toBe("default")
    expect(cfg.defaultWorkflow.vars["qualityReviews"]).toBe("correctness")
    expect(cfg.defaultWorkflow.env["testCommand"]).toBe("npm run ci")
  })

  it("an exported factory and its call are each a workflow, configured on their own", async () => {
    configWith(
      [
        `export { feature as default, feature }`,
        `export const strict = review({ reviewNoteActionable: "0.9" })`,
      ].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.defaultWorkflow.name).toBe("feature")
    expect(cfg.workflowNames).toEqual(["feature", "strict"])
    expect(cfg.workflowNamed("strict")?.vars["reviewNoteActionable"]).toBe("0.9")
    expect(cfg.workflowNamed("feature")?.vars["reviewNoteActionable"]).toBe("0.7")
  })

  it("an invalid option in gtd.config.ts names the workflow, the key path and the expectation", async () => {
    configWith(`export default feature()\nexport const repair = fix({ judgeBudgetBytes: 65536 })`)

    const error = await getConfig().catch((e: Error) => e.message)

    expect(error).toContain(
      `gtd.config.ts: judgeBudgetBytes: workflow "repair" option "judgeBudgetBytes"`,
    )
  })

  it("a misspelled option fails the load, listing the options there are", async () => {
    configWith(`export default feature({ testComand: "npm test" })`)

    const error = await getConfig().catch((e: Error) => e.message)

    expect(error).toMatch(/gtd\.config\.ts: testComand: workflow "default" option "testComand"/)
  })

  it("a door naming a rejected factory reports the option error alone", async () => {
    configWith(
      [
        `export default feature({ testComand: "x" } as never)`,
        `export const doors = { go: { workflow: "default" } }`,
      ].join("\n"),
    )

    const error = await getConfig().catch((e: Error) => e.message)

    expect(error).toContain(`option "testComand"`)
    expect(error).not.toContain("door")
  })
})

describe("ConfigService — a factory's built settings", () => {
  it("a door a factory builds is held to the door-name rule, naming workflow and door", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { defineWorkflow, human } from "@pmelab/gtd/flows"`,
        `const any = { "~standard": { version: 1, vendor: "t", validate: (value) => ({ value }) } }`,
        `export const audit = defineWorkflow(any, () => ({`,
        `  flow: async () => { await human("idle") },`,
        `  doors: { Bad_Name: {} },`,
        `}))`,
        `export default audit`,
        ``,
      ].join("\n"),
    )

    await expect(getConfig()).rejects.toThrow(/workflow "audit" builds door "Bad_Name", which/)
  })

  it("are held to the setting-name rule, like a file's defaults", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { defineWorkflow, human } from "@pmelab/gtd/flows"`,
        `const any = { "~standard": { version: 1, vendor: "t", validate: (value) => ({ value }) } }`,
        `export default defineWorkflow(any, () => ({`,
        `  flow: async () => { await human("idle") },`,
        `  defaults: { "x=y": "z" },`,
        `}))`,
        ``,
      ].join("\n"),
    )

    await expect(getConfig()).rejects.toThrow(
      /workflow "default" builds defaults "x=y", not a valid setting name/,
    )
  })

  it("a build declaring one name as both a process and an environment setting is refused", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { defineWorkflow, human } from "@pmelab/gtd/flows"`,
        `const any = { "~standard": { version: 1, vendor: "t", validate: (value) => ({ value }) } }`,
        `export default defineWorkflow(any, () => ({`,
        `  flow: async () => { await human("idle") },`,
        `  defaults: { x: "1" },`,
        `  envDefaults: { x: "2" },`,
        `}))`,
        ``,
      ].join("\n"),
    )

    await expect(getConfig()).rejects.toThrow(`"x" declared in both "defaults" and "envDefaults"`)
  })

  it("a build declaring a setting that is no string is refused", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { defineWorkflow, human } from "@pmelab/gtd/flows"`,
        `const any = { "~standard": { version: 1, vendor: "t", validate: (value) => ({ value }) } }`,
        `export default defineWorkflow(any, () => ({`,
        `  flow: async () => { await human("idle") },`,
        `  defaults: { x: 1 },`,
        `}))`,
        ``,
      ].join("\n"),
    )

    await expect(getConfig()).rejects.toThrow(/builds defaults "x", whose value is not a string/)
  })
})
