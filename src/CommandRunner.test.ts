import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NodeContext } from "@effect/platform-node"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import { CommandRunner } from "./CommandRunner.js"
import { Cwd } from "./Cwd.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gtd-command-runner-test-"))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const run = <A>(eff: Effect.Effect<A, Error, CommandRunner>) =>
  Effect.runPromise(
    eff.pipe(
      Effect.provide(CommandRunner.Live),
      Effect.provide(Cwd.layer(tmpDir)),
      Effect.provide(NodeContext.layer),
    ),
  )

describe("CommandRunner.bash", () => {
  it("reports a non-zero exit as a value, not a failure", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const runner = yield* CommandRunner
        return yield* runner.bash("exit 3")
      }),
    )
    expect(outcome.status).toBe(3)
  })

  it("reports a zero exit as a value", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const runner = yield* CommandRunner
        return yield* runner.bash("exit 0")
      }),
    )
    expect(outcome.status).toBe(0)
  })

  it("combines stdout then stderr, in that order", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const runner = yield* CommandRunner
        return yield* runner.bash('echo "out line"; echo "err line" >&2')
      }),
    )
    expect(outcome.output).toBe("out line\nerr line\n")
  })

  it("runs in the configured working directory", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const runner = yield* CommandRunner
        return yield* runner.bash("pwd")
      }),
    )
    // macOS symlinks /tmp under /private — resolve both sides before comparing.
    expect(realpathSync(outcome.output.trim())).toBe(realpathSync(tmpDir))
  })

  it("reports signal death as status: null, matching spawnSync", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const runner = yield* CommandRunner
        return yield* runner.bash("kill -9 $$")
      }),
    )
    expect(outcome.status).toBeNull()
  })

  it("a missing binary inside the command is a non-zero exit, not a spawn failure", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const runner = yield* CommandRunner
        return yield* runner.bash("this-binary-does-not-exist-anywhere")
      }),
    )
    expect(outcome.status).not.toBe(0)
  })

  it("fails the Effect when the process itself cannot be spawned (bad cwd)", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const runner = yield* CommandRunner
        return yield* runner.bash("true")
      }).pipe(
        Effect.provide(CommandRunner.Live),
        Effect.provide(Cwd.layer(join(tmpDir, "does-not-exist"))),
        Effect.provide(NodeContext.layer),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
