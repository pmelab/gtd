import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { NodeContext } from "@effect/platform-node"
import { Effect, Exit, Layer } from "effect"
import { ConfigInit, ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"

// ConfigService.Live only loads/validates config; the stub write+commit lives
// in ConfigInit (invoked by the program AFTER the repo-root guard, never at
// layer construction). Both layers get FileSystem + CommandExecutor from
// NodeContext.layer, exactly as main.ts provides them, alongside Cwd.
const liveLayer = (dir: string) =>
  Layer.provide(ConfigService.Live, Layer.merge(Cwd.layer(dir), NodeContext.layer))

const initLayer = (dir: string) =>
  Layer.provide(ConfigInit.Live, Layer.merge(Cwd.layer(dir), NodeContext.layer))

const runExit = <A>(eff: Effect.Effect<A, Error, ConfigService>, dir: string) =>
  Effect.runPromiseExit(eff.pipe(Effect.provide(liveLayer(dir))))

const getConfig = (dir: string) =>
  runExit(
    Effect.flatMap(ConfigService, (c) => Effect.succeed(c)),
    dir,
  )

const runEnsure = (dir: string) =>
  Effect.runPromiseExit(
    Effect.flatMap(ConfigInit, (init) => init.ensure).pipe(Effect.provide(initLayer(dir))),
  )

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "gtd-schema-"))
  // Make it a real git repo so the stub commit path can be exercised.
  execFileSync("git", ["init", "-q"], { cwd: projectDir })
  execFileSync("git", ["config", "user.email", "t@t.test"], { cwd: projectDir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: projectDir })
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe("ConfigService $schema + stub", () => {
  it("decodes a config containing a $schema key without an excess-property error", async () => {
    writeFileSync(
      join(projectDir, ".gtdrc.json"),
      JSON.stringify({ $schema: "https://example.com/schema.json", testCommand: "with schema" }),
    )

    const exit = await getConfig(projectDir)

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.testCommand).toBe("with schema")
    }
  })

  it("loading config does NOT create a stub — only ConfigInit.ensure does", async () => {
    const exit = await getConfig(projectDir)

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(existsSync(join(projectDir, ".gtdrc.json"))).toBe(false)
  })

  it("ensure creates a .gtdrc.json stub with the exact $schema content when no config exists", async () => {
    const exit = await runEnsure(projectDir)

    expect(Exit.isSuccess(exit)).toBe(true)
    const stubPath = join(projectDir, ".gtdrc.json")
    expect(existsSync(stubPath)).toBe(true)
    expect(readFileSync(stubPath, "utf8")).toBe(
      `{\n  "$schema": "https://raw.githubusercontent.com/pmelab/gtd/main/schema.json"\n}\n`,
    )
  })

  it("ensure commits the stub with a path-scoped add and the chore message", async () => {
    await runEnsure(projectDir)

    const subject = execFileSync("git", ["log", "-1", "--pretty=%s"], {
      cwd: projectDir,
    })
      .toString()
      .trim()
    expect(subject).toBe("chore: add .gtdrc.json")

    // Only the stub was staged/committed — path-scoped add, not `git add -A`.
    const committedFiles = execFileSync(
      "git",
      ["show", "--name-only", "--pretty=format:", "HEAD"],
      { cwd: projectDir },
    )
      .toString()
      .trim()
    expect(committedFiles).toBe(".gtdrc.json")
  })

  it("ensure does not write or commit a stub when a config already exists", async () => {
    writeFileSync(join(projectDir, ".gtdrc.yaml"), `testCommand: "existing"\n`)

    const exit = await runEnsure(projectDir)

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(existsSync(join(projectDir, ".gtdrc.json"))).toBe(false)
    // No commit was created (fresh repo has no HEAD).
    expect(() =>
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, stdio: "ignore" }),
    ).toThrow()
  })
})
