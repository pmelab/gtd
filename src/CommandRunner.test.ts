import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import { NodeContext } from "@effect/platform-node"
import { CommandRunner } from "./CommandRunner.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-command-runner-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const run = (command: string, cwd: string) =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    return yield* runner.run(command, cwd)
  }).pipe(Effect.provide(CommandRunner.Live), Effect.provide(NodeContext.layer))

describe("CommandRunner.Live", () => {
  it("reports a 0 exit with combined stdout+stderr output", async () => {
    const outcome = await Effect.runPromise(run('echo "out line"; echo "err line" >&2', tmpDir))
    expect(outcome.status).toBe(0)
    expect(outcome.output).toBe("out line\nerr line\n")
  })

  it("reports a non-zero exit as DATA, not a failure", async () => {
    const outcome = await Effect.runPromise(run('echo "boom"; exit 3', tmpDir))
    expect(outcome.status).toBe(3)
    expect(outcome.output).toBe("boom\n")
  })

  it("runs relative to the given cwd", async () => {
    const outcome = await Effect.runPromise(run("pwd -P", tmpDir))
    expect(outcome.output.trim()).toBe(realpathSync(tmpDir))
  })

  it("fails the Effect on a genuine spawn failure (an unreadable cwd)", async () => {
    const exit = await Effect.runPromiseExit(run("echo hi", join(tmpDir, "does-not-exist")))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("fails the Effect on a signal death, same as a spawn failure", async () => {
    // Probed @effect/platform's own NodeCommandExecutor directly: a signal
    // death does NOT resolve `process.exitCode` to a number (nor to `null`)
    // — the executor itself fails with a `SystemError` ("Process interrupted
    // due to receipt of signal"). So `status: number | null` stays in the
    // port for contract completeness (a test adapter via `CommandRunner.layer`
    // can still construct a `status: null` outcome directly), but through
    // this Live layer a signal death surfaces as an Effect FAILURE, not as
    // `CommandOutcome` data — the same as any other spawn/executor failure.
    const exit = await Effect.runPromiseExit(run("kill -9 $$", tmpDir))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
