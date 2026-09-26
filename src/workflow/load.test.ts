import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"
import { NodeContext } from "@effect/platform-node"
import { GtdError, Narrator } from "../Commentary.js"
import { ConfigDiscovery, ConfigService, configPresentAt, load } from "./index.js"
import { GitService, Host, Workspace } from "../platform/index.js"
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

// A one-step workflow whose only step is named `first`.
const minimalWorkflow = (first: string) =>
  [
    `import { human, workflow } from "@pmelab/gtd/flows"`,
    ``,
    `export default workflow(async () => {`,
    `  await human("${first}")`,
    `})`,
    ``,
  ].join("\n")

describe("ConfigService", () => {
  it("with no config anywhere: falls back to the built-in default workflow", async () => {
    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("idle")
    expect(cfg.workflowVars["testCommand"]).toBe("npm test")
    expect(cfg.rcVars).toEqual({})
  })

  it("a config with a top-level `vars:` but no gtd.config.ts uses the built-in default", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `vars:\n  testCommand: "custom-test"\n`)

    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("idle")
    expect(cfg.rcVars).toEqual({ testCommand: "custom-test" })
  })

  it("layers a top-level `modes:` key over the built-in modes", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.yaml"),
      [`modes:`, `  qa:`, `    format: "adr-fmt <%= it.file %>"`, ``].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.modes["qa"]).toEqual({
      format: "adr-fmt <%= it.file %>",
      validate: seededValidateCommand("qa"),
    })
  })

  it("reads a custom workflow from gtd.config.ts in cwd", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), minimalWorkflow("custom-idle"))

    const cfg = await getConfig()

    expect(cfg.workflow.initial).toBe("custom-idle")
  })

  it("takes the innermost gtd.config.ts — workflows are never merged", async () => {
    const child = join(projectDir, "a", "b")
    mkdirSync(child, { recursive: true })
    writeFileSync(join(projectDir, "gtd.config.ts"), minimalWorkflow("ancestor-idle"))
    writeFileSync(join(child, "gtd.config.ts"), minimalWorkflow("child-idle"))

    const cfg = await getConfig(child)

    expect(cfg.workflow.initial).toBe("child-idle")
  })

  it("rejects a `workflow:` key in a .gtdrc, pointing at gtd.config.ts", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `workflow:\n  entry: {}\n`)

    await expect(getConfig()).rejects.toThrow(/define the workflow in gtd\.config\.ts/)
  })

  it("rejects a gtd.config.ts whose default export is not a workflow", async () => {
    writeFileSync(join(projectDir, "gtd.config.ts"), `export default { nope: true }\n`)

    await expect(getConfig()).rejects.toThrow(/not a workflow\(\.\.\.\)/)
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
      [`modes:`, `  adr:`, `    validate: "adr-lint <%= it.file %>"`, ``].join("\n"),
    )
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { human, workflow } from "@pmelab/gtd/flows"`,
        ``,
        `export default workflow(async () => {`,
        `  await human("idle", { message: "hi", file: "docs/adr.md", mode: "adr" })`,
        `})`,
        ``,
      ].join("\n"),
    )

    const cfg = await getConfig()

    expect(cfg.workflow.modes["adr"]).toEqual({ validate: "adr-lint <%= it.file %>" })
  })

  it("rejects a default entry that never reaches a step", async () => {
    writeFileSync(
      join(projectDir, "gtd.config.ts"),
      [
        `import { workflow } from "@pmelab/gtd/flows"`,
        ``,
        `export default workflow(async () => {})`,
        ``,
      ].join("\n"),
    )

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
