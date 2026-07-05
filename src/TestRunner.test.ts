import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { NodeContext } from "@effect/platform-node"
import { TestRunner } from "./TestRunner.js"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"

let projectDir: string

const run = <A>(eff: Effect.Effect<A, Error, TestRunner>) =>
  Effect.runPromise(
    eff.pipe(
      // `TestRunner.Live` now requires `ConfigService` and `Cwd`; provide both
      // here so the test exercises the real config-driven command resolution in
      // the temp project directory.
      Effect.provide(TestRunner.Live),
      Effect.provide(ConfigService.Live),
      Effect.provide(Cwd.layer(projectDir)),
      Effect.provide(NodeContext.layer),
    ),
  )

/**
 * Writes a minimal package.json whose `test` script runs the given shell
 * snippet. The snippet drives exit code and output for each scenario.
 */
function writeProject(testScript: string, extraScripts: Record<string, string> = {}) {
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        version: "0.0.0",
        private: true,
        scripts: { test: testScript, ...extraScripts },
      },
      null,
      2,
    ),
  )
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "gtd-testrunner-"))
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

describe("TestRunner", () => {
  it("runs `npm run test` and yields exitCode 0 with captured output when the script passes", async () => {
    writeProject("echo SENTINEL_PASS")

    const result = await run(Effect.flatMap(TestRunner, (t) => t.run()))

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("SENTINEL_PASS")
  })

  it("succeeds (does not fail the Effect) and returns non-zero exitCode with output when the script fails", async () => {
    writeProject("echo SENTINEL_FAIL && exit 3")

    const result = await run(Effect.flatMap(TestRunner, (t) => t.run()))

    expect(result.exitCode).not.toBe(0)
    expect(result.output).toContain("SENTINEL_FAIL")
  })

  it("captures stderr in the combined output", async () => {
    writeProject("echo ON_STDERR 1>&2; exit 0")

    const result = await run(Effect.flatMap(TestRunner, (t) => t.run()))

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("ON_STDERR")
  })

  it("invokes the project's `test` script (proving the command is `npm run test`)", async () => {
    // Only the `test` script writes the sentinel; any other invocation would not.
    writeProject("echo CONFIRM_NPM_RUN_TEST")

    const result = await run(Effect.flatMap(TestRunner, (t) => t.run()))

    expect(result.output).toContain("CONFIRM_NPM_RUN_TEST")
  })

  it("runs the `testCommand` configured in .gtdrc instead of the default", async () => {
    // The default `test` script writes a sentinel that must NOT appear; only the
    // `othertest` script (the configured command) writes CUSTOM_SENTINEL.
    writeProject("echo DEFAULT_SENTINEL", { othertest: "echo CUSTOM_SENTINEL" })
    // cwd is the temp project dir (chdir'd in beforeEach) and lives under
    // os.tmpdir(), outside home — so this cwd-level config is the only one found.
    writeFileSync(join(projectDir, ".gtdrc.yaml"), "testCommand: npm run othertest\n")

    const result = await run(Effect.flatMap(TestRunner, (t) => t.run()))

    expect(result.output).toContain("CUSTOM_SENTINEL")
    expect(result.output).not.toContain("DEFAULT_SENTINEL")
  })
})
