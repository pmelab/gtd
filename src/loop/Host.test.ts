import { Effect } from "effect"
import { expect, it } from "vitest"
import { LoopHost, liveLoopHost } from "./Host.js"

const spawn = (stopAt?: (line: string) => boolean) =>
  Effect.runPromise(
    Effect.flatMap(LoopHost, (host) =>
      host.spawn({
        command: "sh",
        args: ["-c", "echo one; echo stop; sleep 5; echo after"],
        output: "capture",
        ...(stopAt === undefined ? {} : { stopAt }),
      }),
    ).pipe(Effect.provide(liveLoopHost)),
  )

it("stops the child at the first stdout line stopAt accepts", async () => {
  const exit = await spawn((line) => line === "stop")
  expect(exit.stopped).toBe(true)
  expect(exit.stdout).not.toContain("after")
  expect(exit.code).toBe(143)
})

it("runs to the end when no line is accepted", async () => {
  const exit = await spawn((line) => line === "never")
  expect(exit.stopped).toBeUndefined()
  expect(exit.stdout).toBe("one\nstop\nafter\n")
}, 10_000)
