import { FileSystem } from "@effect/platform"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, it } from "vitest"
import { ToolCommands } from "./cli/index.js"
import { CommandRunner, GtdUsageError } from "./platform/index.js"
import { liveToolCommands } from "./program.js"

it("gtd ui over a worktree that can't be read refuses as a usage error", async () => {
  const tools = liveToolCommands.pipe(
    Layer.provide(CommandRunner.layer(() => Effect.fail(new Error("no shell in this test")))),
    Layer.provide(FileSystem.layerNoop({})),
  )
  const exit = await Effect.runPromiseExit(
    Effect.flatMap(ToolCommands, ({ ui }) =>
      ui(
        {
          flags: { selfSigned: false, dev: false },
          config: undefined,
          root: join(tmpdir(), "gtd-no-such-worktree"),
        },
        { write: () => {}, flush: () => {} },
      ),
    ).pipe(Effect.provide(tools)),
  )

  const error = Exit.isFailure(exit)
    ? Option.getOrUndefined(Cause.failureOption(exit.cause))
    : undefined
  expect(error).toBeInstanceOf(GtdUsageError)
  expect(error?.message).toMatch(/^gtd ui: refuses to start — this worktree can't be read/)
})
