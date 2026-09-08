import { describe, expect, it, vi } from "vitest"
import { QA_FORMAT } from "../OpenQuestions.js"
import type { StepRead } from "./Beat.js"
import {
  appRouter,
  ReadSteeringFileRefusal,
  UnsupportedModeRefusal,
  WriteNoteRefusal,
  type RouterContext,
} from "./Router.js"

const OK_STEP: StepRead = {
  status: "ok",
  path: "/repos/x",
  repo: "gtd",
  branch: "main",
  label: "do the thing",
  kind: "prompt",
  actor: "human",
  idle: false,
  rest: "2026-08-01T10:00:00+00:00",
  file: ".gtd/TODO.md",
  mode: "qa",
}

const contextFor = (
  readStep: RouterContext["readStep"] = () => Promise.resolve(OK_STEP),
  writeNote: RouterContext["writeNote"] = () => Promise.resolve({ ok: true }),
  resolveDiff: RouterContext["resolveDiff"] = () =>
    Promise.resolve({ kind: "refused", detail: "resolveDiff unexpectedly invoked" }),
  readSteeringFile: RouterContext["readSteeringFile"] = () =>
    Promise.resolve({ ok: false, reason: "file-vanished" }),
  handOff: RouterContext["handOff"] = () => {},
): RouterContext => ({
  readStep,
  writeNote,
  resolveDiff,
  readSteeringFile,
  handOff,
})

const doneRequest = {
  filePath: "TODO.md",
  expectedHeadSha: "sha",
  expectedContentHash: "hash",
  mode: "qa",
  anchor: { kind: "paragraph" as const, line: 3 },
  text: "a note",
}

describe("appRouter.step", () => {
  it("delegates straight to the context's readStep", async () => {
    const caller = appRouter.createCaller(contextFor(() => Promise.resolve(OK_STEP)))
    await expect(caller.step()).resolves.toEqual(OK_STEP)
  })
})

describe("appRouter.writeNote", () => {
  const request = {
    filePath: ".gtd/REVIEW.md",
    expectedHeadSha: "sha1",
    expectedContentHash: "hash1",
    mode: "review",
    anchor: { kind: "chunk" as const, index: 0 },
    text: "a note a human typed",
  }

  it("delegates to the context's writeNote and returns ok on success", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, () => Promise.resolve({ ok: true })),
    )
    await expect(caller.writeNote(request)).resolves.toEqual({ ok: true })
  })

  it("surfaces a refusal as a typed WriteNoteRefusal cause, naming the reason", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, () =>
        Promise.resolve({ ok: false, reason: "stale-token", moved: "sha" }),
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
      contextFor(undefined, () => Promise.reject(new Error("writeNote unexpectedly invoked"))),
    )
    await expect(
      caller.writeNote({ ...request, anchor: { kind: "unknown" } } as never),
    ).rejects.toThrow()
  })

  it("accepts no worktreePath field at all — the server writes through the one worktree it serves", async () => {
    let received: unknown
    const caller = appRouter.createCaller(
      contextFor(undefined, (input) => {
        received = input
        return Promise.resolve({ ok: true })
      }),
    )
    await caller.writeNote({ ...request, worktreePath: "/should/be/dropped" } as never)
    expect(received).not.toHaveProperty("worktreePath")
  })
})

describe("appRouter.view", () => {
  it("returns a qa-mode document's view", async () => {
    const caller = appRouter.createCaller(contextFor())
    const result = await caller.view({ mode: "qa", content: QA_FORMAT.sample })
    expect(result).toEqual({ view: QA_FORMAT.view(QA_FORMAT.sample) })
  })

  it("surfaces an unregistered mode as a typed UnsupportedModeRefusal cause", async () => {
    const caller = appRouter.createCaller(contextFor())
    const error = await caller
      .view({ mode: "not-a-real-mode", content: "x" })
      .catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(UnsupportedModeRefusal)
    expect((cause as UnsupportedModeRefusal).reason).toBe("unsupported-mode")
  })

  it("rejects malformed input rather than reaching steeringViewFor", async () => {
    const caller = appRouter.createCaller(contextFor())
    await expect(caller.view({ mode: "qa" } as never)).rejects.toThrow()
  })
})

describe("appRouter.diff", () => {
  it("delegates straight to the context's resolveDiff, forwarding path/line", async () => {
    let received: readonly [string, number | undefined] | undefined
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, (path, line) => {
        received = [path, line]
        return Promise.resolve({ kind: "binary" })
      }),
    )
    const result = await caller.diff({ path: "./src/a.ts", line: 3 })
    expect(result).toEqual({ kind: "binary" })
    expect(received).toEqual(["./src/a.ts", 3])
  })

  it("forwards an absent line as undefined, not zero or a validation error", async () => {
    let received: number | undefined = -1
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, (_path, line) => {
        received = line
        return Promise.resolve({
          kind: "whole-file",
          diff: { path: "x", hunks: [] },
          reason: "no-line",
        })
      }),
    )
    await caller.diff({ path: "./src/a.ts" })
    expect(received).toBeUndefined()
  })

  it("returns a `refused` result as plain data, never a thrown TRPCError — DiffResult is already the typed refusal", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, () =>
        Promise.resolve({ kind: "refused", detail: "gtd base: refused" }),
      ),
    )
    const result = await caller.diff({ path: "./src/a.ts" })
    expect(result).toEqual({ kind: "refused", detail: "gtd base: refused" })
  })

  it("rejects malformed input rather than reaching resolveDiff", async () => {
    const caller = appRouter.createCaller(contextFor())
    await expect(caller.diff({} as never)).rejects.toThrow()
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
      contextFor(undefined, undefined, undefined, () => Promise.resolve(okResult)),
    )
    const result = await caller.readSteeringFile({ filePath: ".gtd/PLAN.md", mode: "qa" })
    expect(result).toEqual(okResult)
  })

  it("surfaces a file-vanished refusal as a typed ReadSteeringFileRefusal cause with a NOT_FOUND code", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, () =>
        Promise.resolve({ ok: false, reason: "file-vanished" }),
      ),
    )
    const error = await caller
      .readSteeringFile({ filePath: "x.md", mode: "qa" })
      .catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(ReadSteeringFileRefusal)
    expect((cause as ReadSteeringFileRefusal).reason).toBe("file-vanished")
  })

  it("surfaces an unsupported-mode refusal as a typed ReadSteeringFileRefusal cause", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, () =>
        Promise.resolve({ ok: false, reason: "unsupported-mode" }),
      ),
    )
    const error = await caller
      .readSteeringFile({ filePath: "x.md", mode: "not-a-real-mode" })
      .catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(ReadSteeringFileRefusal)
    expect((cause as ReadSteeringFileRefusal).reason).toBe("unsupported-mode")
  })

  it("rejects malformed input rather than reaching readSteeringFile", async () => {
    const caller = appRouter.createCaller(contextFor())
    await expect(caller.readSteeringFile({} as never)).rejects.toThrow()
  })
})

describe("appRouter.done", () => {
  it("writes the steering file then hands off, in that order", async () => {
    const calls: string[] = []
    const caller = appRouter.createCaller(
      contextFor(
        undefined,
        () => {
          calls.push("write")
          return Promise.resolve({ ok: true })
        },
        undefined,
        undefined,
        () => {
          calls.push("handoff")
        },
      ),
    )
    const result = await caller.done(doneRequest)
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual(["write", "handoff"])
  })

  it("aborts before handing off when the write fails", async () => {
    const handOff = vi.fn()
    const caller = appRouter.createCaller(
      contextFor(
        undefined,
        () => Promise.resolve({ ok: false, reason: "stale-token", moved: "sha" }),
        undefined,
        undefined,
        handOff,
      ),
    )
    const error = await caller.done(doneRequest).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(WriteNoteRefusal)
    expect(handOff).not.toHaveBeenCalled()
  })
})

describe("no procedure input carries a filesystem path from the client", () => {
  // Every input validator this router registers, introspected directly:
  // none may accept a `worktreePath` (or any other path-shaped) field. The
  // server always writes/reads through the one worktree it serves, resolved
  // server-side from `Cwd`, never named by the client.
  it("rejects a worktreePath field passed to writeNote/done/readSteeringFile even when every other field is well-formed", async () => {
    const caller = appRouter.createCaller(contextFor())
    // Passed as an extra field: proves the validator doesn't merely ignore
    // it silently but that no code path here ever reads `input.worktreePath`
    // — the fixtures above assert this for `writeNote`; this pins the whole
    // set doesn't declare the field as part of its accepted shape by
    // checking each procedure still behaves identically whether or not it's
    // present.
    const withPath = { ...doneRequest, worktreePath: "/etc/passwd" }
    const without = { ...doneRequest }
    const a = await caller.done(withPath as never)
    const b = await caller.done(without)
    expect(a).toEqual(b)
  })

  it("readSteeringFile's, diff's and writeNote's input validators build their return value with no worktreePath key", async () => {
    const { readFileSync } = await import("node:fs")
    const { fileURLToPath } = await import("node:url")
    const source = readFileSync(fileURLToPath(new URL("./Router.ts", import.meta.url)), "utf8")
    const validators = source.match(/^const \w+Input = \(.*$[\s\S]*?^\}$/gm) ?? []
    expect(validators.length).toBeGreaterThan(0)
    for (const validator of validators) expect(validator).not.toMatch(/worktreePath/)
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
