import { FileSystem } from "@effect/platform"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, it, vi } from "vitest"

const loaded = vi.hoisted(() => new Set<string>())
vi.mock("./ui/index.js", async (importOriginal) => (loaded.add("ui"), importOriginal()))
// lsp and judges stand in for a broken install: importing either fails. Vitest
// replaces a factory's own message, so the tests below read only that a cause
// follows gtd's prefix.
vi.mock("./lsp/index.js", () => {
  loaded.add("lsp")
  throw new Error("missing")
})
vi.mock("./judges/index.js", () => {
  loaded.add("judges")
  throw new Error("missing")
})

import { runCli, ToolCommands } from "./cli/index.js"
import { CONFIG_SCAFFOLD } from "./install/index.js"
import { CommandRunner, GtdError, GtdUsageError } from "./platform/index.js"
import { liveToolCommands } from "./program.js"
import { InMemRepo, makeCapturingCliIo } from "./twins/index.js"
import { EXIT_RUNTIME_ERROR } from "./wire/index.js"

const tools = liveToolCommands.pipe(
  Layer.provide(CommandRunner.layer(() => Effect.fail(new Error("no shell in this test")))),
  Layer.provide(FileSystem.layerNoop({})),
)

it("gtd next loads no ui, lsp or judge module", async () => {
  const repo = new InMemRepo()
  repo.writeFile("gtd.config.ts", CONFIG_SCAFFOLD)
  repo.seedCommit("chore: init")
  const live = await Effect.runPromise(Effect.provide(ToolCommands, tools))
  const { io, result } = makeCapturingCliIo(repo, {}, live)

  await Effect.runPromise(runCli(["node", "gtd.js", "next", "--json"], io))

  expect(result().exitCode).toBe(0)
  expect([...loaded]).toEqual([])
})

it("gtd ui over a worktree that can't be read refuses as a usage error", async () => {
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
  expect([...loaded]).toEqual(["ui"])
})

it("a tool that fails to load fails its command as a GtdError, exit 1", async () => {
  const live = await Effect.runPromise(Effect.provide(ToolCommands, tools))
  const { io, result } = makeCapturingCliIo(new InMemRepo(), {}, live)

  await Effect.runPromise(runCli(["node", "gtd.js", "lsp"], io))

  expect(result().exitCode).toBe(EXIT_RUNTIME_ERROR)
  expect(result().stderr).toMatch(/gtd lsp: could not load — \S/)
  // `gtd judge run` reads the process's real stdin, so its port is driven here.
  const judged = live.judge({ provider: "fixed", cwd: tmpdir(), env: {}, input: "" })
  await expect(judged).rejects.toBeInstanceOf(GtdError)
  await expect(judged).rejects.toThrow(/^gtd judge: could not load — \S/)
})
