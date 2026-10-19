import { Effect, Layer } from "effect"
import { expect, it } from "vitest"
import { runContextHook } from "./ContextHook.js"
import { LoopHost } from "./index.js"

const run = (env: Record<string, string>, failAppend = false) => {
  const appended: [string, string][] = []
  const host = Layer.succeed(LoopHost, {
    env,
    color: false,
    spawn: () => Effect.fail(new Error("no spawn")),
    readFile: () => Effect.succeed(undefined),
    resetLog: () => Effect.void,
    appendLog: (path, text) =>
      Effect.sync(() => {
        if (failAppend) throw new Error("EACCES")
        appended.push([path, text])
      }),
    say: () => Effect.void,
  })
  const input = JSON.stringify({ hook_event_name: "PreCompact", transcript_path: "/t.jsonl" })
  return Effect.runPromise(runContextHook({ input }).pipe(Effect.provide(host))).then((out) => ({
    out,
    appended,
  }))
}

it("records a hard stop's reason where the driver asked, so it can tell it from another hook's", async () => {
  const { out, appended } = await run({ GTD_LOOP_CONTEXT_STOP_FILE: "/log.context-stop" })
  expect(out).toContain('"continue":false')
  expect(appended).toEqual([
    [
      "/log.context-stop",
      expect.stringMatching(/^gtd: context limit: the context is about to be compacted/),
    ],
  ])
})

it("records nothing when no driver asked", async () => {
  expect((await run({})).appended).toEqual([])
})

it("still stops the turn when the record cannot be written", async () => {
  const { out } = await run({ GTD_LOOP_CONTEXT_STOP_FILE: "/gone/log.context-stop" }, true)
  expect(out).toContain('"continue":false')
})
