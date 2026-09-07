import { TRPCError, initTRPC } from "@trpc/server"
import { Effect, Runtime } from "effect"
import { CommandRunner } from "../CommandRunner.js"
import type { SteeringAnchor } from "../SteeringFormat.js"
import type { FleetPayload } from "./Fleet.js"
import type { WriteNoteRequest, WriteResult } from "./Write.js"

/** What every tRPC resolver needs: the runtime `Server.ts` already captures via `Effect.runtime<ServeRequirements>()` for its HTML-serving path — reused here rather than a second capture. `readFleet` closes over a `BeatCache` that lives for the whole server process, never one per request — that's what makes T3's memo actually memoize across requests. `writeNote` closes over the live `WriteDeps` (see `Write.ts`); the router never imports a format module or a filesystem API directly. */
export interface RouterContext {
  readonly runtime: Runtime.Runtime<CommandRunner>
  readonly readFleet: () => Promise<FleetPayload>
  readonly writeNote: (request: WriteNoteRequest) => Promise<WriteResult>
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

const t = initTRPC.context<RouterContext>().create({
  errorFormatter({ shape, error }) {
    const refusal = error.cause instanceof CommandRefusal ? error.cause : undefined
    const writeRefusal = error.cause instanceof WriteNoteRefusal ? error.cause : undefined
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
})

export type AppRouter = typeof appRouter
