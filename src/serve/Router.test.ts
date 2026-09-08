import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { CommandRunner, type CommandOutcome } from "../CommandRunner.js"
import { QA_FORMAT } from "../OpenQuestions.js"
import {
  appRouter,
  CommandRefusal,
  DriveRefusal,
  ReadSteeringFileRefusal,
  UnsupportedModeRefusal,
  WriteNoteRefusal,
  type RouterContext,
} from "./Router.js"

/** A `Runtime<CommandRunner>` over a canned `bash` — the same runtime-capture pattern `Server.ts` uses for its HTML-serving path, scoped here to just the one service a router test needs. */
const contextFor = (
  bash: (command: string) => Effect.Effect<CommandOutcome, Error>,
  readFleet: RouterContext["readFleet"] = () =>
    Promise.resolve({
      buckets: { "wants-you": [], working: [], broken: [], quiet: [] },
      wantsYouCount: 0,
    }),
  writeNote: RouterContext["writeNote"] = () => Promise.resolve({ ok: true }),
  resolveDiff: RouterContext["resolveDiff"] = () =>
    Promise.resolve({ kind: "refused", detail: "resolveDiff unexpectedly invoked" }),
  readSteeringFile: RouterContext["readSteeringFile"] = () =>
    Promise.resolve({ ok: false, reason: "file-vanished" }),
  startLoop: RouterContext["startLoop"] = () => Promise.resolve({ ok: true }),
  stopLoop: RouterContext["stopLoop"] = () => Promise.resolve(),
): RouterContext => ({
  runtime: Effect.runSync(
    Effect.runtime<CommandRunner>().pipe(Effect.provide(CommandRunner.layer(bash))),
  ),
  readFleet,
  writeNote,
  resolveDiff,
  readSteeringFile,
  startLoop,
  stopLoop,
})

const doneRequest = {
  worktreePath: "/repos/x",
  filePath: "TODO.md",
  expectedHeadSha: "sha",
  expectedContentHash: "hash",
  mode: "qa",
  anchor: { kind: "paragraph" as const, line: 3 },
  text: "a note",
}

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

describe("appRouter.writeNote", () => {
  const request = {
    worktreePath: "/repo",
    filePath: ".gtd/REVIEW.md",
    expectedHeadSha: "sha1",
    expectedContentHash: "hash1",
    mode: "review",
    anchor: { kind: "chunk" as const, index: 0 },
    text: "a note a human typed",
  }

  it("delegates to the context's writeNote and returns ok on success", async () => {
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        () => Promise.resolve({ ok: true }),
      ),
    )
    await expect(caller.writeNote(request)).resolves.toEqual({ ok: true })
  })

  it("surfaces a refusal as a typed WriteNoteRefusal cause, naming the reason", async () => {
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        () => Promise.resolve({ ok: false, reason: "stale-token", moved: "sha" }),
      ),
    )
    const error = await caller.writeNote(request).catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(WriteNoteRefusal)
    expect((cause as WriteNoteRefusal).reason).toBe("stale-token")
    expect((cause as WriteNoteRefusal).moved).toBe("sha")
  })

  it("rejects malformed input rather than reaching writeNote", async () => {
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        () => Promise.reject(new Error("writeNote unexpectedly invoked")),
      ),
    )
    await expect(
      caller.writeNote({ ...request, anchor: { kind: "unknown" } } as never),
    ).rejects.toThrow()
  })
})

describe("appRouter.view", () => {
  it("returns a qa-mode document's view", async () => {
    const caller = appRouter.createCaller(
      contextFor(() => Effect.fail(new Error("CommandRunner unexpectedly invoked"))),
    )
    const result = await caller.view({ mode: "qa", content: QA_FORMAT.sample })
    expect(result).toEqual({ view: QA_FORMAT.view(QA_FORMAT.sample) })
  })

  it("surfaces an unregistered mode as a typed UnsupportedModeRefusal cause", async () => {
    const caller = appRouter.createCaller(
      contextFor(() => Effect.fail(new Error("CommandRunner unexpectedly invoked"))),
    )
    const error = await caller
      .view({ mode: "not-a-real-mode", content: "x" })
      .catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(UnsupportedModeRefusal)
    expect((cause as UnsupportedModeRefusal).reason).toBe("unsupported-mode")
  })

  it("rejects malformed input rather than reaching steeringViewFor", async () => {
    const caller = appRouter.createCaller(
      contextFor(() => Effect.fail(new Error("CommandRunner unexpectedly invoked"))),
    )
    await expect(caller.view({ mode: "qa" } as never)).rejects.toThrow()
  })
})

describe("appRouter.diff", () => {
  it("delegates straight to the context's resolveDiff, forwarding worktreePath/path/line", async () => {
    let received: readonly [string, string, number | undefined] | undefined
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        undefined,
        (worktreePath, path, line) => {
          received = [worktreePath, path, line]
          return Promise.resolve({ kind: "binary" })
        },
      ),
    )
    const result = await caller.diff({ worktreePath: "/repo", path: "./src/a.ts", line: 3 })
    expect(result).toEqual({ kind: "binary" })
    expect(received).toEqual(["/repo", "./src/a.ts", 3])
  })

  it("forwards an absent line as undefined, not zero or a validation error", async () => {
    let received: number | undefined = -1
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        undefined,
        (_worktreePath, _path, line) => {
          received = line
          return Promise.resolve({
            kind: "whole-file",
            diff: { path: "x", hunks: [] },
            reason: "no-line",
          })
        },
      ),
    )
    await caller.diff({ worktreePath: "/repo", path: "./src/a.ts" })
    expect(received).toBeUndefined()
  })

  it("returns a `refused` result as plain data, never a thrown TRPCError — DiffResult is already the typed refusal", async () => {
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        undefined,
        () => Promise.resolve({ kind: "refused", detail: "gtd base: refused" }),
      ),
    )
    const result = await caller.diff({ worktreePath: "/repo", path: "./src/a.ts" })
    expect(result).toEqual({ kind: "refused", detail: "gtd base: refused" })
  })

  it("rejects malformed input rather than reaching resolveDiff", async () => {
    const caller = appRouter.createCaller(
      contextFor(() => Effect.fail(new Error("CommandRunner unexpectedly invoked"))),
    )
    await expect(caller.diff({ worktreePath: "/repo" } as never)).rejects.toThrow()
  })
})

describe("appRouter.readSteeringFile", () => {
  it("delegates straight to the context's readSteeringFile, returning the full result on success", async () => {
    const okResult = {
      ok: true as const,
      content: QA_FORMAT.sample,
      headSha: "abc123",
      contentHash: "deadbeef",
      view: QA_FORMAT.view(QA_FORMAT.sample),
    }
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        undefined,
        undefined,
        () => Promise.resolve(okResult),
      ),
    )
    const result = await caller.readSteeringFile({
      worktreePath: "/repo",
      filePath: ".gtd/PLAN.md",
      mode: "qa",
    })
    expect(result).toEqual(okResult)
  })

  it("surfaces a file-vanished refusal as a typed ReadSteeringFileRefusal cause with a NOT_FOUND code", async () => {
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        undefined,
        undefined,
        () => Promise.resolve({ ok: false, reason: "file-vanished" }),
      ),
    )
    const error = await caller
      .readSteeringFile({ worktreePath: "/repo", filePath: "x.md", mode: "qa" })
      .catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(ReadSteeringFileRefusal)
    expect((cause as ReadSteeringFileRefusal).reason).toBe("file-vanished")
  })

  it("surfaces an unsupported-mode refusal as a typed ReadSteeringFileRefusal cause", async () => {
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.fail(new Error("CommandRunner unexpectedly invoked")),
        undefined,
        undefined,
        undefined,
        () => Promise.resolve({ ok: false, reason: "unsupported-mode" }),
      ),
    )
    const error = await caller
      .readSteeringFile({ worktreePath: "/repo", filePath: "x.md", mode: "not-a-real-mode" })
      .catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(ReadSteeringFileRefusal)
    expect((cause as ReadSteeringFileRefusal).reason).toBe("unsupported-mode")
  })

  it("rejects malformed input rather than reaching readSteeringFile", async () => {
    const caller = appRouter.createCaller(
      contextFor(() => Effect.fail(new Error("CommandRunner unexpectedly invoked"))),
    )
    await expect(caller.readSteeringFile({ worktreePath: "/repo" } as never)).rejects.toThrow()
  })
})

describe("appRouter.done", () => {
  it("writes the steering file then spawns the loop, in that order", async () => {
    const calls: string[] = []
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.succeed({ status: 0, output: "", stdout: "", stderr: "" }),
        undefined,
        () => {
          calls.push("write")
          return Promise.resolve({ ok: true })
        },
        undefined,
        undefined,
        () => {
          calls.push("spawn")
          return Promise.resolve({ ok: true })
        },
      ),
    )
    const result = await caller.done(doneRequest)
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual(["write", "spawn"])
  })

  it("aborts before spawning anything when the write fails", async () => {
    const startLoop = vi.fn(() => Promise.resolve({ ok: true as const }))
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.succeed({ status: 0, output: "", stdout: "", stderr: "" }),
        undefined,
        () => Promise.resolve({ ok: false, reason: "stale-token", moved: "sha" }),
        undefined,
        undefined,
        startLoop,
      ),
    )
    const error = await caller.done(doneRequest).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(WriteNoteRefusal)
    expect(startLoop).not.toHaveBeenCalled()
  })

  it("surfaces an already-driving refusal as a named DriveRefusal, distinct from a write refusal", async () => {
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.succeed({ status: 0, output: "", stdout: "", stderr: "" }),
        undefined,
        () => Promise.resolve({ ok: true }),
        undefined,
        undefined,
        () => Promise.resolve({ ok: false, reason: "already-driving" }),
      ),
    )
    const error = await caller.done(doneRequest).catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(DriveRefusal)
    expect((cause as DriveRefusal).reason).toBe("already-driving")
  })
})

describe("appRouter.stop", () => {
  it("delegates to ctx.stopLoop with the given worktreePath", async () => {
    const stopLoop = vi.fn(() => Promise.resolve())
    const caller = appRouter.createCaller(
      contextFor(
        () => Effect.succeed({ status: 0, output: "", stdout: "", stderr: "" }),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        stopLoop,
      ),
    )
    const result = await caller.stop({ worktreePath: "/repos/x" })
    expect(result).toEqual({ ok: true })
    expect(stopLoop).toHaveBeenCalledWith("/repos/x")
  })
})

describe("Router.ts imports no format module and switches on no mode-name string", () => {
  // `View.test.ts` already pins this for `View.ts` itself; that guard covers
  // only that one file. `Router.ts` is a second place a format import or a
  // mode-name switch could sneak in (its own `writeNote`/`view`/`diff`/
  // `readSteeringFile` procedures all take a `mode` as plain input), so it
  // gets the identical guard here rather than relying on `View.ts`'s alone.
  it("imports no ReviewDoc.js/OpenQuestions.js and switches on no mode-name string", async () => {
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const source = readFileSync(fileURLToPath(new URL("./Router.ts", import.meta.url)), "utf8")
    expect(source).not.toMatch(/from ["']\.\.\/ReviewDoc\.js["']/)
    expect(source).not.toMatch(/from ["']\.\.\/OpenQuestions\.js["']/)
    expect(source).not.toMatch(/\bswitch\s*\(/)
    expect(source).not.toMatch(/mode\s*===\s*["'](qa|review)["']/)
  })
})
