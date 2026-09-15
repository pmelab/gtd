import { TRPCError, initTRPC } from "@trpc/server"
import type { SteeringAnchor } from "../steering/index.js"
import type { StepRead } from "./Beat.js"
import type { DiffResult } from "./Diff.js"
import type { ReadSteeringFileRequest, ReadSteeringFileResult } from "./ReadSteeringFile.js"
import { steeringViewFor } from "./View.js"
import type { WriteNoteRequest, WriteResult, WriteValueRequest } from "./Write.js"

/** A request shape with the client-supplied `worktreePath` stripped — the server always writes/reads through the one worktree it serves, closed over server-side, never named by the client. */
type NoWorktreePath<T> = Omit<T, "worktreePath">

/** What every tRPC resolver needs: the one worktree `Server.ts` serves, closed over by every function here — no path ever reaches this router from a request. `readStep`/`writeNote`/`readSteeringFile`/`resolveDiff` each close over their own live deps (see `Beat.ts`/`Write.ts`/`ReadSteeringFile.ts`/`Diff.ts`). `handOff` is the done action's second half: resolves the deferred `Server.ts`'s main Effect awaits in place of `Effect.never`, so the process exits once the HTTP response carrying `done`'s result has actually flushed. The router never imports a format module or a filesystem API directly. */
export interface RouterContext {
  readonly readStep: () => Promise<StepRead>
  readonly writeNote: (request: NoWorktreePath<WriteNoteRequest>) => Promise<WriteResult>
  readonly writeValue: (request: NoWorktreePath<WriteValueRequest>) => Promise<WriteResult>
  readonly resolveDiff: (path: string, line: number | undefined) => Promise<DiffResult>
  readonly readSteeringFile: (
    request: NoWorktreePath<ReadSteeringFileRequest>,
  ) => Promise<ReadSteeringFileResult>
  /** Schedules the process exit that follows a successful `done` — never invoked directly by anything in this file besides `done` itself. */
  readonly handOff: () => void
}

/** One of `Write.ts#WriteNoteRequest`'s four typed refusals, carried as a thrown `TRPCError`'s `cause` — the phone renders a different sentence for each, read off `error.data.writeRefusal`, never off `error.message`. */
export class WriteNoteRefusal extends Error {
  constructor(
    readonly reason: import("./Write.js").WriteRefusalReason,
    readonly moved?: "sha" | "content-hash",
  ) {
    super(`gtd ui: write refused (${reason})`)
    this.name = "WriteNoteRefusal"
  }
}

/** `View.ts#steeringViewFor`'s one typed refusal, carried as a thrown `TRPCError`'s `cause` — read back on the client via `error.data.viewRefusal.reason`, mirroring `WriteNoteRefusal`'s own pattern. */
export class UnsupportedModeRefusal extends Error {
  constructor(readonly reason: import("./View.js").SteeringViewRefusalReason) {
    super(`gtd ui: view refused (${reason})`)
    this.name = "UnsupportedModeRefusal"
  }
}

/** One of `ReadSteeringFile.ts#ReadSteeringFileResult`'s two typed refusals, carried as a thrown `TRPCError`'s `cause` — read back on the client via `error.data.readRefusal.reason`, mirroring `WriteNoteRefusal`'s own pattern. */
export class ReadSteeringFileRefusal extends Error {
  constructor(readonly reason: "file-vanished" | "unsupported-mode" | "head-unresolved") {
    super(`gtd ui: read refused (${reason})`)
    this.name = "ReadSteeringFileRefusal"
  }
}

/** One `error.cause instanceof Ctor ? map(cause) : undefined` check, factored out so `errorFormatter` itself stays a flat field list instead of one growing branch per refusal type. */
const refusalField = <T, R>(
  cause: unknown,
  ctor: new (...args: never[]) => T,
  map: (value: T) => R,
): R | undefined => (cause instanceof ctor ? map(cause) : undefined)

const t = initTRPC.context<RouterContext>().create({
  errorFormatter({ shape, error }) {
    const { cause } = error
    return {
      ...shape,
      data: {
        ...shape.data,
        writeRefusal: refusalField(cause, WriteNoteRefusal, (r) => ({
          reason: r.reason,
          moved: r.moved,
        })),
        viewRefusal: refusalField(cause, UnsupportedModeRefusal, (r) => ({ reason: r.reason })),
        readRefusal: refusalField(cause, ReadSteeringFileRefusal, (r) => ({ reason: r.reason })),
      },
    }
  },
})

/** True for a plain object with every named string field present and non-empty — the shared shape check `steeringAnchorInput` and `writeNoteInput` both build on. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** Parses a `{ kind: "chunk" | "question", index: number }` anchor — `undefined` when `index` isn't a number. */
const parseIndexedAnchor = (
  kind: "chunk" | "question",
  value: Record<string, unknown>,
): SteeringAnchor | undefined =>
  typeof value.index === "number" ? { kind, index: value.index } : undefined

/** Parses a `{ kind: "hunk", chunkIndex, index }` anchor — `undefined` unless both are numbers. */
const parseHunkAnchor = (value: Record<string, unknown>): SteeringAnchor | undefined =>
  typeof value.chunkIndex === "number" && typeof value.index === "number"
    ? { kind: "hunk", chunkIndex: value.chunkIndex, index: value.index }
    : undefined

/** Parses a `{ kind: "option", questionIndex, index }` anchor — `undefined` unless both are numbers. */
const parseOptionAnchor = (value: Record<string, unknown>): SteeringAnchor | undefined =>
  typeof value.questionIndex === "number" && typeof value.index === "number"
    ? { kind: "option", questionIndex: value.questionIndex, index: value.index }
    : undefined

/** Parses a `{ kind: "paragraph", line }` anchor — `undefined` unless `line` is a number. */
const parseParagraphAnchor = (value: Record<string, unknown>): SteeringAnchor | undefined =>
  typeof value.line === "number" ? { kind: "paragraph", line: value.line } : undefined

/** A `{ kind: string, ... }` shape validator for `SteeringAnchor` — no `zod` dependency, this repo has none. Rejects anything outside the closed `kind` vocabulary (or with the wrong shape for it) rather than passing it through to `annotate` unchecked. */
const steeringAnchorInput = (value: unknown): SteeringAnchor => {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("expected a SteeringAnchor")
  }
  const parsed =
    value.kind === "chunk" || value.kind === "question"
      ? parseIndexedAnchor(value.kind, value)
      : value.kind === "hunk"
        ? parseHunkAnchor(value)
        : value.kind === "option"
          ? parseOptionAnchor(value)
          : value.kind === "paragraph"
            ? parseParagraphAnchor(value)
            : undefined
  if (parsed === undefined) throw new Error(`invalid SteeringAnchor for kind "${value.kind}"`)
  return parsed
}

/** `writeNote`'s own input validator — every field is required, no `worktreePath`: the server writes through the one worktree it serves. `text` is the human's own typed note body, carried verbatim into the new footnote definition (never a placeholder). */
const writeNoteInput = (
  value: unknown,
): {
  readonly filePath: string
  readonly expectedHeadSha: string
  readonly expectedContentHash: string
  readonly mode: string
  readonly anchor: SteeringAnchor
  readonly text: string
} => {
  if (!isRecord(value)) throw new Error("expected a write request")
  const { filePath, expectedHeadSha, expectedContentHash, mode, anchor, text } = value
  for (const field of [filePath, expectedHeadSha, expectedContentHash, mode, text]) {
    if (typeof field !== "string") throw new Error("expected string fields on a write request")
  }
  return {
    filePath: filePath as string,
    expectedHeadSha: expectedHeadSha as string,
    expectedContentHash: expectedContentHash as string,
    mode: mode as string,
    anchor: steeringAnchorInput(anchor),
    text: text as string,
  }
}

/** `setValue`'s own optional `checked` field — `undefined` when absent, thrown when present but not a boolean. Split out of `setValueInput` so its two optional-field checks don't inflate that function's own branching. */
const parseOptionalChecked = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error("expected checked to be a boolean when present")
  return value
}

/** `setValue`'s own optional `text` field — mirrors `parseOptionalChecked` for the string case. */
const parseOptionalText = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error("expected text to be a string when present")
  return value
}

/**
 * `setValue`'s own input validator — mirrors `writeNoteInput` field for
 * field, except `checked`/`text` are both OPTIONAL (a hunk tick sends only
 * `checked`; a free-text commit sends both together): no `worktreePath`, the
 * server writes through the one worktree it serves.
 */
const setValueInput = (
  value: unknown,
): {
  readonly filePath: string
  readonly expectedHeadSha: string
  readonly expectedContentHash: string
  readonly mode: string
  readonly anchor: SteeringAnchor
  readonly checked?: boolean
  readonly text?: string
} => {
  if (!isRecord(value)) throw new Error("expected a write request")
  const { filePath, expectedHeadSha, expectedContentHash, mode, anchor, checked, text } = value
  for (const field of [filePath, expectedHeadSha, expectedContentHash, mode]) {
    if (typeof field !== "string") throw new Error("expected string fields on a write request")
  }
  const parsedChecked = parseOptionalChecked(checked)
  const parsedText = parseOptionalText(text)
  return {
    filePath: filePath as string,
    expectedHeadSha: expectedHeadSha as string,
    expectedContentHash: expectedContentHash as string,
    mode: mode as string,
    anchor: steeringAnchorInput(anchor),
    ...(parsedChecked !== undefined ? { checked: parsedChecked } : {}),
    ...(parsedText !== undefined ? { text: parsedText } : {}),
  }
}

/**
 * `done`'s own input validator — `{ note?: <writeNoteInput fields> }`, one
 * optional nested object rather than `writeNoteInput`'s own six
 * independently-optional flat fields (which could arrive in half-valid
 * combinations). `note` present is validated by `writeNoteInput` itself, so
 * a malformed note throws here, before `done`'s resolver ever runs — never
 * reaching `ctx.writeNote`/`ctx.handOff`. `note` absent needs no tokens:
 * there is nothing to compare-and-swap when nothing is written.
 */
const doneInput = (
  value: unknown,
): {
  readonly note?: ReturnType<typeof writeNoteInput>
} => {
  if (!isRecord(value)) throw new Error("expected a done request")
  if (value.note === undefined) return {}
  return { note: writeNoteInput(value.note) }
}

/** `steeringView`'s own input validator — a `{ content: string, mode: string }`, no `worktreePath`. */
const viewInput = (value: unknown): { readonly content: string; readonly mode: string } => {
  if (!isRecord(value) || typeof value.content !== "string" || typeof value.mode !== "string") {
    throw new Error("expected { content: string, mode: string }")
  }
  return { content: value.content, mode: value.mode }
}

/** `resolveDiff`'s own input validator — `{ path: string, line?: number }`, no `worktreePath`. `line` is optional: a bare pointer with no line number is a real, valid case (`resolveDiff`'s own "no line number"), not a validation failure. */
const diffInput = (value: unknown): { readonly path: string; readonly line?: number } => {
  if (!isRecord(value) || typeof value.path !== "string") {
    throw new Error("expected { path: string, line?: number }")
  }
  if (value.line !== undefined && typeof value.line !== "number") {
    throw new Error("expected line to be a number when present")
  }
  return { path: value.path, ...(value.line !== undefined ? { line: value.line } : {}) }
}

/** `readSteeringFile`'s own input validator — `{ filePath: string, mode: string }`, no `worktreePath`. */
const readSteeringFileInput = (
  value: unknown,
): { readonly filePath: string; readonly mode: string } => {
  if (!isRecord(value) || typeof value.filePath !== "string" || typeof value.mode !== "string") {
    throw new Error("expected { filePath: string, mode: string }")
  }
  return { filePath: value.filePath, mode: value.mode }
}

export const appRouter = t.router({
  /** The step screen's one read: the served worktree's own beat, projected — no input, since there is only ever one worktree to read (see `Beat.ts#readStep`). */
  step: t.procedure.query(({ ctx }) => ctx.readStep()),

  /**
   * The compare-and-swap steering-file write (package 03): delegates every
   * check and the actual splice to `Write.ts#writeNote`, which this router
   * never re-implements or second-guesses. A refusal becomes a `TRPCError`
   * whose `cause` is a `WriteNoteRefusal` — read back on the client via
   * `error.data.writeRefusal.reason`, one of the four typed refusals, never
   * a shared message string.
   */
  writeNote: t.procedure.input(writeNoteInput).mutation(async ({ input, ctx }) => {
    const result = await ctx.writeNote(input)
    if (!result.ok) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `gtd ui: write refused (${result.reason})`,
        cause: new WriteNoteRefusal(result.reason, result.moved),
      })
    }
    return { ok: true as const }
  }),

  /**
   * The compare-and-swap CHECKBOX write (package 03): a question's radio
   * pick, a hunk tick, or a chunk's check-all — delegates every check and the
   * actual splice to `Write.ts#writeValue`, which calls `SteeringFormat.apply`
   * instead of `annotate`. The SAME `WriteNoteRefusal` class `writeNote`
   * throws carries the refusal here too, so `api.ts#writeRefusalFrom` needs
   * no changes to read it — it reads `error.data.writeRefusal` off any
   * procedure's thrown `WriteNoteRefusal`, regardless of procedure name.
   */
  setValue: t.procedure.input(setValueInput).mutation(async ({ input, ctx }) => {
    const result = await ctx.writeValue(input)
    if (!result.ok) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `gtd ui: write refused (${result.reason})`,
        cause: new WriteNoteRefusal(result.reason, result.moved),
      })
    }
    return { ok: true as const }
  }),

  /**
   * The done action: writes the steering file exactly as `writeNote` does
   * WHEN `note` is present, then hands the turn back — `ctx.handOff()`
   * schedules the process exit that follows this response actually reaching
   * the client, never spawning a child process or waiting for one. `note`
   * absent skips the write entirely (nothing to compare-and-swap) and goes
   * straight to `ctx.handOff()` — a human who has nothing to leave behind
   * still needs a way to end the turn. A write failure aborts before
   * anything is scheduled, surfaced identically to `writeNote`'s own
   * `WriteNoteRefusal`. The server itself emits no beat, lands no turn, and
   * creates no session — the outer loop that started `gtd ui` re-reads gtd
   * state after the process exits and drives the next turn itself.
   */
  done: t.procedure.input(doneInput).mutation(async ({ input, ctx }) => {
    if (input.note !== undefined) {
      const write = await ctx.writeNote(input.note)
      if (!write.ok) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `gtd ui: write refused (${write.reason})`,
          cause: new WriteNoteRefusal(write.reason, write.moved),
        })
      }
    }
    ctx.handOff()
    return { ok: true as const }
  }),

  /**
   * The steering screen's one read: `View.ts#steeringViewFor`'s pure
   * dispatch, never a format module import or a switch on `input.mode` here
   * either. A refusal becomes a `TRPCError` whose `cause` is an
   * `UnsupportedModeRefusal` — read back on the client via
   * `error.data.viewRefusal.reason`.
   */
  view: t.procedure.input(viewInput).query(({ input }) => {
    const result = steeringViewFor(input.mode, input.content)
    if (!result.ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `gtd ui: view refused (${result.reason})`,
        cause: new UnsupportedModeRefusal(result.reason),
      })
    }
    return { view: result.view }
  }),

  /**
   * A hunk screen's one read: `Diff.ts#resolveDiff`'s pure dispatch (`gtd
   * base` plus a `git diff` of that base against `HEAD` — never the working
   * tree, see `Diff.ts#resolveDiff`'s own doc comment for why — sliced to
   * the pointed-at hunk when one resolves) — never re-implemented here.
   * `DiffResult` is already a closed, JSON-serializable union (`hunk` /
   * `whole-file` / `binary` / `refused`), so unlike `writeNote`/`view` there
   * is nothing to lift into a `TRPCError`'s `cause`: a `refused` result IS
   * the typed refusal, returned as plain data for the client to switch on.
   */
  diff: t.procedure
    .input(diffInput)
    .query(({ input, ctx }) => ctx.resolveDiff(input.path, input.line)),

  /**
   * A screen's one entry point before it can render OR write back:
   * `ReadSteeringFile.ts#readSteeringFile`'s live read of the file's exact
   * bytes plus its `view` and the two `writeNote`-compatible tokens
   * (`headSha`/`contentHash`), all in one round trip — so a container never
   * has to invent a second fetch to get the tokens a later `writeNote` call
   * needs. A refusal becomes a `TRPCError` whose `cause` is a
   * `ReadSteeringFileRefusal` — read back via `error.data.readRefusal.reason`.
   */
  readSteeringFile: t.procedure.input(readSteeringFileInput).query(async ({ input, ctx }) => {
    const result = await ctx.readSteeringFile(input)
    if (!result.ok) {
      throw new TRPCError({
        code: result.reason === "file-vanished" ? "NOT_FOUND" : "BAD_REQUEST",
        message: `gtd ui: read refused (${result.reason})`,
        cause: new ReadSteeringFileRefusal(result.reason),
      })
    }
    return result
  }),
})

export type AppRouter = typeof appRouter
