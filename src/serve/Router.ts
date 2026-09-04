import { TRPCError, initTRPC } from "@trpc/server"
import { Effect, Runtime } from "effect"
import { CommandRunner } from "../CommandRunner.js"

/** What every tRPC resolver needs: the runtime `Server.ts` already captures via `Effect.runtime<ServeRequirements>()` for its HTML-serving path — reused here rather than a second capture. */
export interface RouterContext {
  readonly runtime: Runtime.Runtime<CommandRunner>
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

const t = initTRPC.context<RouterContext>().create({
  errorFormatter({ shape, error }) {
    const refusal = error.cause instanceof CommandRefusal ? error.cause : undefined
    return {
      ...shape,
      data: {
        ...shape.data,
        refusal:
          refusal === undefined
            ? undefined
            : { stdout: refusal.stdout, stderr: refusal.stderr, exitCode: refusal.exitCode },
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

export const appRouter = t.router({
  /**
   * Runs a vetted shell command via `CommandRunner` and returns its outcome.
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
})

export type AppRouter = typeof appRouter
