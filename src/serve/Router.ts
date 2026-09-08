import { TRPCError, initTRPC } from "@trpc/server"
import { Effect, Runtime } from "effect"
import { CommandRunner } from "../CommandRunner.js"
import type { SteeringAnchor } from "../SteeringFormat.js"
import type { DiffResult } from "./Diff.js"
import type { FleetPayload } from "./Fleet.js"
import type { ReadSteeringFileRequest, ReadSteeringFileResult } from "./ReadSteeringFile.js"
import { steeringViewFor } from "./View.js"
import type { WriteNoteRequest, WriteResult } from "./Write.js"

/** What every tRPC resolver needs: the runtime `Server.ts` already captures via `Effect.runtime<ServeRequirements>()` for its HTML-serving path — reused here rather than a second capture. `readFleet` closes over a `BeatCache` that lives for the whole server process, never one per request — that's what makes T3's memo actually memoize across requests. `writeNote`/`readSteeringFile` close over the live `WriteDeps`/`ReadSteeringFileDeps` (see `Write.ts`/`ReadSteeringFile.ts`); `resolveDiff` closes over the live `DiffDeps` (see `Diff.ts`) the same way. The router never imports a format module or a filesystem API directly. */
export interface RouterContext {
  readonly runtime: Runtime.Runtime<CommandRunner>
  readonly readFleet: () => Promise<FleetPayload>
  readonly writeNote: (request: WriteNoteRequest) => Promise<WriteResult>
  readonly resolveDiff: (
    worktreePath: string,
    path: string,
    line: number | undefined,
  ) => Promise<DiffResult>
  readonly readSteeringFile: (request: ReadSteeringFileRequest) => Promise<ReadSteeringFileResult>
}

/**
 * A non-zero exit as a typed refusal: set as a thrown `TRPCError`'s `cause` so
 * the error formatter below can lift `stdout`/`stderr`/`exitCode` into
 * `error.data.refusal`, separately readable on the client — never flattened
 * into `error.message`, because every gtd refusal exits 1 and the text is the
 * only discriminator.
 */
export class CommandRefusal extends Error {
  constructor(
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super("gtd serve: command exited non-zero")
    this.name = "CommandRefusal"
  }
}

/** One of `Write.ts#WriteNoteRequest`'s four typed refusals, carried as a thrown `TRPCError`'s `cause` — T8's "the phone renders a different sentence for each" reads this off `error.data.writeRefusal`, never off `error.message`. */
export class WriteNoteRefusal extends Error {
  constructor(
    readonly reason: import("./Write.js").WriteRefusalReason,
    readonly moved?: "sha" | "content-hash",
  ) {
    super(`gtd serve: write refused (${reason})`)
    this.name = "WriteNoteRefusal"
  }
}

/** `View.ts#steeringViewFor`'s one typed refusal, carried as a thrown `TRPCError`'s `cause` — read back on the client via `error.data.viewRefusal.reason`, mirroring `WriteNoteRefusal`'s own pattern. */
export class UnsupportedModeRefusal extends Error {
  constructor(readonly reason: import("./View.js").SteeringViewRefusalReason) {
    super(`gtd serve: view refused (${reason})`)
    this.name = "UnsupportedModeRefusal"
  }
}

/** One of `ReadSteeringFile.ts#ReadSteeringFileResult`'s two typed refusals, carried as a thrown `TRPCError`'s `cause` — read back on the client via `error.data.readRefusal.reason`, mirroring `WriteNoteRefusal`'s own pattern. */
export class ReadSteeringFileRefusal extends Error {
  constructor(readonly reason: "file-vanished" | "unsupported-mode") {
    super(`gtd serve: read refused (${reason})`)
    this.name = "ReadSteeringFileRefusal"
  }
}

const t = initTRPC.context<RouterContext>().create({
  errorFormatter({ shape, error }) {
    const refusal = error.cause instanceof CommandRefusal ? error.cause : undefined
    const writeRefusal = error.cause instanceof WriteNoteRefusal ? error.cause : undefined
    const viewRefusal = error.cause instanceof UnsupportedModeRefusal ? error.cause : undefined
    const readRefusal = error.cause instanceof ReadSteeringFileRefusal ? error.cause : undefined
    return {
      ...shape,
      data: {
        ...shape.data,
        refusal:
          refusal === undefined
            ? undefined
            : { stdout: refusal.stdout, stderr: refusal.stderr, exitCode: refusal.exitCode },
        writeRefusal:
          writeRefusal === undefined
            ? undefined
            : { reason: writeRefusal.reason, moved: writeRefusal.moved },
        viewRefusal: viewRefusal === undefined ? undefined : { reason: viewRefusal.reason },
        readRefusal: readRefusal === undefined ? undefined : { reason: readRefusal.reason },
      },
    }
  },
})

/** A `{ command: string }` input validator with no `zod` dependency — this repo has none yet, and one field doesn't warrant adding one. */
const commandInput = (value: unknown): { command: string } => {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { command?: unknown }).command !== "string"
  ) {
    throw new Error("expected { command: string }")
  }
  return value as { command: string }
}

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

/** A `{ kind: string, ... }` shape validator for `SteeringAnchor` — no `zod` dependency, mirroring `commandInput`. Rejects anything outside the closed `kind` vocabulary (or with the wrong shape for it) rather than passing it through to `annotate` unchecked. */
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

/** `writeNote`'s own input validator — every field is required, no `zod` dependency, mirroring `commandInput`. `text` is the human's own typed note body, carried verbatim into the new footnote definition (never a placeholder). */
const writeNoteInput = (
  value: unknown,
): {
  readonly worktreePath: string
  readonly filePath: string
  readonly expectedHeadSha: string
  readonly expectedContentHash: string
  readonly mode: string
  readonly anchor: SteeringAnchor
  readonly text: string
} => {
  if (!isRecord(value)) throw new Error("expected a write request")
  const { worktreePath, filePath, expectedHeadSha, expectedContentHash, mode, anchor, text } = value
  for (const field of [worktreePath, filePath, expectedHeadSha, expectedContentHash, mode, text]) {
    if (typeof field !== "string") throw new Error("expected string fields on a write request")
  }
  return {
    worktreePath: worktreePath as string,
    filePath: filePath as string,
    expectedHeadSha: expectedHeadSha as string,
    expectedContentHash: expectedContentHash as string,
    mode: mode as string,
    anchor: steeringAnchorInput(anchor),
    text: text as string,
  }
}

/** `steeringView`'s own input validator — a `{ content: string, mode: string }`, no `zod` dependency, mirroring `commandInput`. */
const viewInput = (value: unknown): { readonly content: string; readonly mode: string } => {
  if (!isRecord(value) || typeof value.content !== "string" || typeof value.mode !== "string") {
    throw new Error("expected { content: string, mode: string }")
  }
  return { content: value.content, mode: value.mode }
}

/** `resolveDiff`'s own input validator — `{ worktreePath: string, path: string, line?: number }`, no `zod` dependency, mirroring `commandInput`. `line` is optional: a bare pointer with no line number is T3's own "no line number" case, not a validation failure. */
const diffInput = (
  value: unknown,
): { readonly worktreePath: string; readonly path: string; readonly line?: number } => {
  if (
    !isRecord(value) ||
    typeof value.worktreePath !== "string" ||
    typeof value.path !== "string"
  ) {
    throw new Error("expected { worktreePath: string, path: string, line?: number }")
  }
  if (value.line !== undefined && typeof value.line !== "number") {
    throw new Error("expected line to be a number when present")
  }
  return {
    worktreePath: value.worktreePath,
    path: value.path,
    ...(value.line !== undefined ? { line: value.line } : {}),
  }
}

/** `readSteeringFile`'s own input validator — `{ worktreePath: string, filePath: string, mode: string }`, no `zod` dependency, mirroring `commandInput`. */
const readSteeringFileInput = (
  value: unknown,
): { readonly worktreePath: string; readonly filePath: string; readonly mode: string } => {
  if (
    !isRecord(value) ||
    typeof value.worktreePath !== "string" ||
    typeof value.filePath !== "string" ||
    typeof value.mode !== "string"
  ) {
    throw new Error("expected { worktreePath: string, filePath: string, mode: string }")
  }
  return { worktreePath: value.worktreePath, filePath: value.filePath, mode: value.mode }
}

export const appRouter = t.router({
  /**
   * Runs `input.command` VERBATIM via `CommandRunner` — `commandInput` only
   * checks it is a string, nothing about its content. The unauthenticated
   * surface is the accepted design (tailnet-only binding, `gtd serve`
   * refuses to start otherwise); this is arbitrary shell execution on
   * whatever bound the server, and any future caller must treat it as such.
   * The single Effect-to-Promise boundary for this resolver is the
   * `Runtime.runPromise` call below — everything upstream of it stays Effect.
   */
  runCommand: t.procedure.input(commandInput).mutation(async ({ input, ctx }) => {
    const outcome = await Runtime.runPromise(ctx.runtime)(
      Effect.gen(function* () {
        const runner = yield* CommandRunner
        return yield* runner.bash(input.command)
      }),
    )
    if (outcome.status !== 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "gtd serve: command exited non-zero",
        cause: new CommandRefusal(outcome.stdout ?? "", outcome.stderr ?? "", outcome.status),
      })
    }
    return { stdout: outcome.stdout ?? "", stderr: outcome.stderr ?? "", exitCode: outcome.status }
  }),

  /** The fleet screen's one read: re-scans the configured roots and every worktree's beat, never failing outright on one bad worktree (see `Fleet.ts`'s `readFleet`). */
  fleet: t.procedure.query(({ ctx }) => ctx.readFleet()),

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
        message: `gtd serve: write refused (${result.reason})`,
        cause: new WriteNoteRefusal(result.reason, result.moved),
      })
    }
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
        message: `gtd serve: view refused (${result.reason})`,
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
    .query(({ input, ctx }) => ctx.resolveDiff(input.worktreePath, input.path, input.line)),

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
        message: `gtd serve: read refused (${result.reason})`,
        cause: new ReadSteeringFileRefusal(result.reason),
      })
    }
    return result
  }),
})

export type AppRouter = typeof appRouter
