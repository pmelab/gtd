import { describe, expect, it, vi } from "vitest"
import { widgetFormat } from "../steering/index.js"
import type { StepRead } from "./Beat.js"
import {
  appRouter,
  ReadSteeringFileRefusal,
  WriteNoteRefusal,
  ProceedRefusal,
  type RouterContext,
} from "./Router.js"

const PLAN = "# Plan\n\n## 🔘 Store?\n\n- [ ] Redis\n- [ ] Memory\n"

const OK_STEP: StepRead = {
  status: "ok",
  path: "/repos/x",
  repo: "gtd",
  branch: "main",
  label: "do the thing",
  state: "doing",
  kind: "prompt",
  actor: "human",
  idle: false,
  rest: "2026-08-01T10:00:00+00:00",
  file: ".gtd/TODO.md",
}

/** Every `writeNote`/`writeValue`/`done` fake below that just needs to succeed resolves this — a real `Write.ts#WriteSuccess` always carries `contentHash` now, so a bare `{ ok: true }` no longer type-checks as one. */
const WRITE_OK = { ok: true as const, contentHash: "content-hash" }

const contextFor = (
  readStep: RouterContext["readStep"] = () => Promise.resolve(OK_STEP),
  writeNote: RouterContext["writeNote"] = () => Promise.resolve(WRITE_OK),
  resolveDiff: RouterContext["resolveDiff"] = () =>
    Promise.resolve({ kind: "refused", detail: "resolveDiff unexpectedly invoked" }),
  readSteeringFile: RouterContext["readSteeringFile"] = () =>
    Promise.resolve({ ok: false, reason: "file-vanished" }),
  writeValue: RouterContext["writeValue"] = () => Promise.resolve(WRITE_OK),
  writeValues: RouterContext["writeValues"] = () => Promise.resolve(WRITE_OK),
): RouterContext => ({
  readStep,
  writeNote,
  writeValue,
  writeValues,
  resolveDiff,
  readSteeringFile,
})

const doneNote = {
  filePath: "TODO.md",
  expectedHeadSha: "sha",
  expectedContentHash: "hash",
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
    anchor: { kind: "question" as const, index: 0 },
    text: "a note a human typed",
  }

  it("delegates to the context's writeNote and returns ok on success, forwarding contentHash", async () => {
    const caller = appRouter.createCaller(contextFor(undefined, () => Promise.resolve(WRITE_OK)))
    await expect(caller.writeNote(request)).resolves.toEqual(WRITE_OK)
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
        return Promise.resolve(WRITE_OK)
      }),
    )
    await caller.writeNote({ ...request, worktreePath: "/should/be/dropped" } as never)
    expect(received).not.toHaveProperty("worktreePath")
  })
})

describe("appRouter.setValue", () => {
  const request = {
    filePath: ".gtd/REVIEW.md",
    expectedHeadSha: "sha1",
    expectedContentHash: "hash1",
    anchor: { kind: "hunk" as const, chunkIndex: 0, index: 0 },
    checked: true,
  }

  it("delegates to the context's writeValue and returns ok on success, forwarding contentHash", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, undefined, () => Promise.resolve(WRITE_OK)),
    )
    await expect(caller.setValue(request)).resolves.toEqual(WRITE_OK)
  })

  it("surfaces a refusal as a typed WriteNoteRefusal cause, naming the reason", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, undefined, () =>
        Promise.resolve({ ok: false, reason: "stale-token", moved: "content-hash" }),
      ),
    )
    const error = await caller.setValue(request).catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(WriteNoteRefusal)
    expect((cause as WriteNoteRefusal).reason).toBe("stale-token")
    expect((cause as WriteNoteRefusal).moved).toBe("content-hash")
  })

  it("rejects malformed input rather than reaching writeValue", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, undefined, () =>
        Promise.reject(new Error("writeValue unexpectedly invoked")),
      ),
    )
    await expect(
      caller.setValue({ ...request, anchor: { kind: "unknown" } } as never),
    ).rejects.toThrow()
  })

  it("accepts no worktreePath field at all — the server writes through the one worktree it serves", async () => {
    let received: unknown
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, undefined, (input) => {
        received = input
        return Promise.resolve(WRITE_OK)
      }),
    )
    await caller.setValue({ ...request, worktreePath: "/should/be/dropped" } as never)
    expect(received).not.toHaveProperty("worktreePath")
  })

  it("accepts checked and text together in one call, and accepts checked alone with no text field", async () => {
    let received: unknown
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, undefined, (input) => {
        received = input
        return Promise.resolve(WRITE_OK)
      }),
    )
    await caller.setValue({ ...request, checked: true, text: "my answer" })
    expect(received).toMatchObject({ checked: true, text: "my answer" })

    await caller.setValue(request)
    expect(received).toMatchObject({ checked: true })
    expect(received).not.toHaveProperty("text")
  })
})

describe("appRouter.setValues", () => {
  const request = {
    filePath: ".gtd/REVIEW.md",
    expectedHeadSha: "sha1",
    expectedContentHash: "hash1",
    values: [
      { anchor: { kind: "hunk" as const, chunkIndex: 0, index: 0 }, checked: true },
      { anchor: { kind: "option" as const, questionIndex: 1, index: 2 }, checked: false },
    ],
  }
  const withWriteValues = (writeValues: RouterContext["writeValues"]) =>
    appRouter.createCaller(
      contextFor(undefined, undefined, undefined, undefined, undefined, writeValues),
    )

  it("delegates the tokens and every entry to the context's writeValues", async () => {
    let received: unknown
    const caller = withWriteValues((input) => {
      received = input
      return Promise.resolve(WRITE_OK)
    })
    await expect(caller.setValues(request)).resolves.toEqual(WRITE_OK)
    expect(received).toEqual(request)
  })

  it("surfaces a refusal as a typed WriteNoteRefusal cause, naming the reason", async () => {
    const caller = withWriteValues(() =>
      Promise.resolve({ ok: false, reason: "stale-token", moved: "content-hash" }),
    )
    const error = await caller.setValues(request).catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(WriteNoteRefusal)
    expect((cause as WriteNoteRefusal).reason).toBe("stale-token")
    expect((cause as WriteNoteRefusal).moved).toBe("content-hash")
  })

  it("rejects a non-array values and an entry with a bad anchor before writeValues", async () => {
    const caller = withWriteValues(() =>
      Promise.reject(new Error("writeValues unexpectedly invoked")),
    )
    await expect(caller.setValues({ ...request, values: "x" } as never)).rejects.toThrow()
    await expect(
      caller.setValues({ ...request, values: [{ anchor: { kind: "unknown" } }] } as never),
    ).rejects.toThrow()
  })
})

describe("appRouter.view", () => {
  it("returns the document's widget view", async () => {
    const caller = appRouter.createCaller(contextFor())
    const result = await caller.view({ content: PLAN })
    expect(result).toEqual({ view: widgetFormat.view(PLAN) })
  })

  it("rejects malformed input rather than reaching steeringViewFor", async () => {
    const caller = appRouter.createCaller(contextFor())
    await expect(caller.view({} as never)).rejects.toThrow()
  })
})

describe("appRouter.diff", () => {
  it("delegates straight to the context's resolveDiff, forwarding path/line", async () => {
    let received: readonly [string, number | undefined, number | undefined] | undefined
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, (path, line, endLine) => {
        received = [path, line, endLine]
        return Promise.resolve({ kind: "binary" })
      }),
    )
    const result = await caller.diff({ path: "./src/a.ts", line: 3 })
    expect(result).toEqual({ kind: "binary" })
    expect(received).toEqual(["./src/a.ts", 3, undefined])
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

  it("forwards path, line, and endLine together when all three are given", async () => {
    let received: readonly [string, number | undefined, number | undefined] | undefined
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, (path, line, endLine) => {
        received = [path, line, endLine]
        return Promise.resolve({ kind: "binary" })
      }),
    )
    await caller.diff({ path: "./src/a.ts", line: 42, endLine: 70 })
    expect(received).toEqual(["./src/a.ts", 42, 70])
  })

  it("a missing endLine is not a validation failure — { path } and { path, line } still validate", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, () => Promise.resolve({ kind: "binary" })),
    )
    await expect(caller.diff({ path: "./src/a.ts" })).resolves.toEqual({ kind: "binary" })
    await expect(caller.diff({ path: "./src/a.ts", line: 3 })).resolves.toEqual({ kind: "binary" })
  })

  it("rejects a non-number endLine with the same 'number when present' error shape line already produces", async () => {
    const caller = appRouter.createCaller(contextFor())
    await expect(caller.diff({ path: "./src/a.ts", endLine: "70" } as never)).rejects.toThrow()
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
      content: PLAN,
      headSha: "abc123",
      contentHash: "deadbeef",
      view: widgetFormat.view(PLAN),
    }
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, () => Promise.resolve(okResult)),
    )
    const result = await caller.readSteeringFile({ filePath: ".gtd/PLAN.md" })
    expect(result).toEqual(okResult)
  })

  it("surfaces a file-vanished refusal as a typed ReadSteeringFileRefusal cause with a NOT_FOUND code", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, () =>
        Promise.resolve({ ok: false, reason: "file-vanished" }),
      ),
    )
    const error = await caller.readSteeringFile({ filePath: "x.md" }).catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(ReadSteeringFileRefusal)
    expect((cause as ReadSteeringFileRefusal).reason).toBe("file-vanished")
  })

  it("surfaces a head-unresolved refusal as a typed ReadSteeringFileRefusal cause with a BAD_REQUEST code", async () => {
    const caller = appRouter.createCaller(
      contextFor(undefined, undefined, undefined, () =>
        Promise.resolve({ ok: false, reason: "head-unresolved" }),
      ),
    )
    const error = await caller.readSteeringFile({ filePath: "x.md" }).catch((e: unknown) => e)
    const cause = (error as { cause?: unknown }).cause
    expect(cause).toBeInstanceOf(ReadSteeringFileRefusal)
    expect((cause as ReadSteeringFileRefusal).reason).toBe("head-unresolved")
    expect((error as { code?: string }).code).toBe("BAD_REQUEST")
  })

  it("rejects malformed input rather than reaching readSteeringFile", async () => {
    const caller = appRouter.createCaller(contextFor())
    await expect(caller.readSteeringFile({} as never)).rejects.toThrow()
  })
})

describe("appRouter.proceed", () => {
  it("presses the caller's proceed at the given commit", async () => {
    const proceed = vi.fn(() => Promise.resolve({ ok: true as const }))
    const caller = appRouter.createCaller({ ...contextFor(), proceed })
    expect(await caller.proceed({ commit: "abc" })).toEqual({ ok: true })
    expect(proceed).toHaveBeenCalledWith("abc")
  })

  it("a refused press carries its reason as a ProceedRefusal", async () => {
    const proceed = () => Promise.resolve({ ok: false as const, message: "HEAD moved" })
    const caller = appRouter.createCaller({ ...contextFor(), proceed })
    const error = await caller.proceed({ commit: "abc" }).catch((e: unknown) => e)
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(ProceedRefusal)
    expect((error as Error).message).toBe("HEAD moved")
  })

  it("with no proceed path it refuses with 'No driver for this worktree' and reports unavailable", async () => {
    const caller = appRouter.createCaller(contextFor())
    expect(await caller.canProceed()).toEqual({ available: false })
    const error = await caller.proceed({ commit: "abc" }).catch((e: unknown) => e)
    expect((error as Error).message).toBe("No driver for this worktree")
  })
})

describe("no procedure input carries a filesystem path from the client", () => {
  // Every input validator this router registers, introspected directly:
  // none may accept a `worktreePath` (or any other path-shaped) field. The
  // server always writes/reads through the one worktree it serves, resolved
  // server-side from `Host`, never named by the client.
  // Structural, not textual: earlier this grepped Router.ts's own source for
  // the literal string "worktreePath" — which only pinned that ONE field
  // name is gone, not the property its own title claimed (a `filePath`/
  // `path` field, still a client string, could still carry an escaping
  // value straight through). This instead spies on what each procedure
  // actually hands its context function at runtime and asserts none of it
  // carries a `worktreePath` key, however the validator is written. Real
  // path CONTAINMENT — refusing a `filePath`/`path` that escapes the served
  // worktree — is the write/read/diff layer's own job, not the router's;
  // see `Write.test.ts`/`ReadSteeringFile.test.ts`/`Diff.test.ts`'s own
  // "escapes the worktree root" cases for that.
  it("writeNote/readSteeringFile/diff hand their context function the parsed request with no worktreePath key, whatever the client sent", async () => {
    const seenWriteNote: Record<string, unknown>[] = []
    const seenReadSteeringFile: Record<string, unknown>[] = []
    const seenDiff: Record<string, unknown>[] = []
    const caller = appRouter.createCaller(
      contextFor(
        undefined,
        (request) => {
          seenWriteNote.push(request as Record<string, unknown>)
          return Promise.resolve(WRITE_OK)
        },
        (path, line) => {
          seenDiff.push({ path, line })
          return Promise.resolve({ kind: "no-changes" })
        },
        (request) => {
          seenReadSteeringFile.push(request as Record<string, unknown>)
          return Promise.resolve({ ok: false, reason: "file-vanished" })
        },
      ),
    )

    await caller.writeNote({ ...doneNote, worktreePath: "/etc/passwd" } as never)
    // The fake context's readSteeringFile answers `file-vanished`, which the
    // router turns into a thrown TRPCError — irrelevant here, the point is
    // only what request shape reached `ctx.readSteeringFile` before it did.
    await caller
      .readSteeringFile({ filePath: "x.md", worktreePath: "/etc/passwd" } as never)
      .catch(() => {})
    await caller.diff({ path: "x.ts", worktreePath: "/etc/passwd" } as never)

    for (const seen of [seenWriteNote, seenReadSteeringFile, seenDiff]) {
      expect(seen.length).toBeGreaterThan(0)
      for (const request of seen) expect(Object.keys(request)).not.toContain("worktreePath")
    }
  })
})
