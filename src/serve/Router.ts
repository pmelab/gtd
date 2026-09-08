import { TRPCError, initTRPC } from "@trpc/server"
import { Effect, Runtime } from "effect"
import { CommandRunner } from "../CommandRunner.js"
import type { SteeringAnchor } from "../SteeringFormat.js"
import type { DiffResult } from "./Diff.js"
import type { FleetPayload } from "./Fleet.js"
import type { StartLoopResult } from "./Loop.js"
import type { DriveRefusalReason } from "./Registry.js"
import type { ReadSteeringFileRequest, ReadSteeringFileResult } from "./ReadSteeringFile.js"
import { steeringViewFor } from "./View.js"
import type { WriteNoteRequest, WriteResult } from "./Write.js"

/** What every tRPC resolver needs: the runtime `Server.ts` already captures via `Effect.runtime<ServeRequirements>()` for its HTML-serving path — reused here rather than a second capture. `readFleet` closes over a `BeatCache` that lives for the whole server process, never one per request — that's what makes the fleet read's own memo actually memoize across requests. `writeNote`/`readSteeringFile` close over the live `WriteDeps`/`ReadSteeringFileDeps` (see `Write.ts`/`ReadSteeringFile.ts`); `resolveDiff` closes over the live `DiffDeps` (see `Diff.ts`) the same way. `startLoop`/`stopLoop` close over the server's one process-lifetime `Registry` — this router never imports `Shim` or `Registry` itself, staying as ignorant of subprocess spawning as it already is of the filesystem; `StartLoopResult` is `Loop.ts#startLoop`'s own result type, imported here as the consumer, mirroring `Write.ts#WriteResult`/`ReadSteeringFile.ts#ReadSteeringFileResult`/`Diff.ts#DiffResult`. The router never imports a format module or a filesystem API directly. */
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
  /** The done action's second half: spawns the configured loop command and registers it — resolves once spawned, NEVER waiting for the child to exit, so the phone returns to the fleet list immediately. */
  readonly startLoop: (worktreePath: string) => Promise<StartLoopResult>
  /** Stop: SIGINT, escalating to SIGKILL after a timeout — a no-op, not an error, when nothing is live for `worktreePath`. */
  readonly stopLoop: (worktreePath: string) => Promise<void>
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

/** The registry's one named refusal (already-driving), carried as a thrown `TRPCError`'s `cause` — read back on the client via `error.data.driveRefusal.reason`, mirroring `WriteNoteRefusal`'s own pattern. Never a silent no-op: the refusal is a named value the phone can render. */
export class DriveRefusal extends Error {
  constructor(readonly reason: DriveRefusalReason) {
    super(`gtd serve: drive refused (${reason})`)
    this.name = "DriveRefusal"
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
        refusal: refusalField(cause, CommandRefusal, (r) => ({
          stdout: r.stdout,
          stderr: r.stderr,
          exitCode: r.exitCode,
        })),
        driveRefusal: refusalField(cause, DriveRefusal, (r) => ({ reason: r.reason })),
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

/** `resolveDiff`'s own input validator — `{ worktreePath: string, path: string, line?: number }`, no `zod` dependency, mirroring `commandInput`. `line` is optional: a bare pointer with no line number is a real, valid case (`resolveDiff`'s own "no line number"), not a validation failure. */
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

/** `stop`'s own input validator — `{ worktreePath: string }`, no `zod` dependency, mirroring `commandInput`. */
const worktreePathInput = (value: unknown): { readonly worktreePath: string } => {
  if (!isRecord(value) || typeof value.worktreePath !== "string") {
    throw new Error("expected { worktreePath: string }")
  }
  return { worktreePath: value.worktreePath }
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
   * The done action: writes the steering file exactly as `writeNote`
   * does, then hands the turn to the loop — `ctx.startLoop` spawns the
   * configured loop command and registers it, resolving once spawned,
   * never waiting for the child to exit, so this mutation itself returns
   * fast and the phone can return to the fleet list immediately. A write
   * failure aborts before anything is spawned, surfaced identically to
   * `writeNote`'s own `WriteNoteRefusal`. A refused spawn (the registry's
   * already-driving case) becomes a `TRPCError` whose `cause` is a
   * `DriveRefusal` — read back via `error.data.driveRefusal.reason`. The
   * server itself emits no beat, lands no turn, and creates no session —
   * `ctx.startLoop` only spawns and registers, the loop command owns
   * everything else.
   */
  done: t.procedure.input(writeNoteInput).mutation(async ({ input, ctx }) => {
    const write = await ctx.writeNote(input)
    if (!write.ok) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `gtd serve: write refused (${write.reason})`,
        cause: new WriteNoteRefusal(write.reason, write.moved),
      })
    }
    const started = await ctx.startLoop(input.worktreePath)
    if (!started.ok) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `gtd serve: drive refused (${started.reason})`,
        cause: new DriveRefusal(started.reason),
      })
    }
    return { ok: true as const }
  }),

  /**
   * Stop: SIGINT first, escalating to SIGKILL after a timeout —
   * `ctx.stopLoop` does the actual signalling (see `Loop.ts#stopChild`) and
   * removes the registry entry either way. A no-op, not an error, when
   * nothing is live for `input.worktreePath`.
   */
  stop: t.procedure.input(worktreePathInput).mutation(async ({ input, ctx }) => {
    await ctx.stopLoop(input.worktreePath)
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
