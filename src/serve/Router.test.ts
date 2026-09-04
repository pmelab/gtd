import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { CommandRunner, type CommandOutcome } from "../CommandRunner.js"
import { appRouter, CommandRefusal, type RouterContext } from "./Router.js"

/** A `Runtime<CommandRunner>` over a canned `bash` — the same runtime-capture pattern `Server.ts` uses for its HTML-serving path, scoped here to just the one service a router test needs. */
const contextFor = (
  bash: (command: string) => Effect.Effect<CommandOutcome, Error>,
  readFleet: RouterContext["readFleet"] = () =>
    Promise.resolve({
      buckets: { "wants-you": [], working: [], broken: [], quiet: [] },
      wantsYouCount: 0,
    }),
): RouterContext => ({
  runtime: Effect.runSync(
    Effect.runtime<CommandRunner>().pipe(Effect.provide(CommandRunner.layer(bash))),
  ),
  readFleet,
})

describe("appRouter.runCommand", () => {
  it("returns stdout, stderr, and exitCode on a clean exit", async () => {
    const caller = appRouter.createCaller(
      contextFor(() => Effect.succeed({ status: 0, output: "ok\n", stdout: "ok\n", stderr: "" })),
    )
    const result = await caller.runCommand({ command: "echo ok" })
    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 })
  })

  it("surfaces a non-zero exit as a typed refusal with stdout, stderr, and exitCode all separately readable", async () => {
    const caller = appRouter.createCaller(
      contextFor(() =>
        Effect.succeed({
          status: 1,
          output: "partial output\nsome error\n",
          stdout: "partial output\n",
          stderr: "some error\n",
        }),
      ),
    )

    const error = await caller.runCommand({ command: "false" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(CommandRefusal)
    const refusal = cause as CommandRefusal
    expect(refusal.stdout).toBe("partial output\n")
    expect(refusal.stderr).toBe("some error\n")
    expect(refusal.exitCode).toBe(1)
  })

  it("keeps both lines of a two-line stderr intact — no newline collapsing", async () => {
    const caller = appRouter.createCaller(
      contextFor(() =>
        Effect.succeed({
          status: 1,
          output: "line1\nline2\n",
          stdout: "",
          stderr: "line1\nline2\n",
        }),
      ),
    )

    const error = await caller.runCommand({ command: "false" }).catch((e: unknown) => e)
    const refusal = (error as { cause?: unknown }).cause as CommandRefusal
    expect(refusal.stderr).toBe("line1\nline2\n")
    expect(refusal.stderr.split("\n")).toEqual(["line1", "line2", ""])
  })

  it("rejects malformed input rather than reaching CommandRunner", async () => {
    const caller = appRouter.createCaller(
      contextFor(() => Effect.fail(new Error("CommandRunner unexpectedly invoked"))),
    )
    await expect(caller.runCommand({ command: 42 } as never)).rejects.toThrow()
  })
})

describe("appRouter.fleet", () => {
  it("delegates straight to the context's readFleet", async () => {
    const payload = {
      buckets: { "wants-you": [], working: [], broken: [], quiet: [] },
      wantsYouCount: 0,
    }
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        () => Promise.resolve(payload),
      ),
    )
    await expect(caller.fleet()).resolves.toEqual(payload)
  })
})
