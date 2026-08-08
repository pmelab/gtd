/**
 * The port that runs a rendered shell command and reports its outcome as
 * DATA rather than a failure — the seam `src/SteeringMode.ts` runs a mode's
 * `format:`/`validate:` command through, and #157's own command-running
 * concern besides (hence the mode-neutral name: this port has nothing
 * mode-specific about its contract). Mirrors `src/Git.ts`'s own `run` (`bash
 * -c`, piped stdout+stderr, concatenated stdout-then-stderr) but does NOT
 * fail on a non-zero exit — a mode's non-zero exit is its way of saying
 * "invalid", a value its caller branches on, not an error. Only a genuine
 * spawn failure (no `bash`, an unreadable `cwd`) fails the Effect.
 */

import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Stream } from "effect"

/** One command run's outcome: its exit status (a signal death reported as `null`) and its combined output (stdout then stderr). */
export interface CommandOutcome {
  readonly status: number | null
  readonly output: string
}

export class CommandRunner extends Context.Tag("CommandRunner")<
  CommandRunner,
  {
    readonly run: (command: string, cwd: string) => Effect.Effect<CommandOutcome, Error>
  }
>() {
  /**
   * Runs `command` for real via `bash -c`, against the platform's
   * `CommandExecutor`. A non-zero EXIT is data (`CommandOutcome.status`), per
   * this module's contract — but a SIGNAL death is not: probed directly
   * against `@effect/platform-node`'s executor, `process.exitCode` does not
   * resolve to a number (or to `null`) for a killed process — the executor
   * itself fails with a `SystemError` ("Process interrupted due to receipt of
   * signal"), indistinguishable here from a genuine spawn failure. So a
   * signal death fails this Effect rather than resolving with `status: null`;
   * `status: number | null` stays in the type for a test adapter
   * (`CommandRunner.layer`) that wants to construct that case directly.
   */
  static readonly Live: Layer.Layer<CommandRunner, never, CommandExecutor.CommandExecutor> =
    Layer.effect(
      CommandRunner,
      Effect.map(CommandExecutor.CommandExecutor, (executor) => ({
        run: (command: string, cwd: string) =>
          runViaExecutor(command, cwd).pipe(
            Effect.provideService(CommandExecutor.CommandExecutor, executor),
          ),
      })),
    )

  /** A test double: `run` delegates straight to the given function — no subprocess, no `CommandExecutor` requirement. */
  static readonly layer = (
    run: (command: string, cwd: string) => Effect.Effect<CommandOutcome, Error>,
  ): Layer.Layer<CommandRunner> => Layer.succeed(CommandRunner, { run })
}

const runViaExecutor = (
  command: string,
  cwd: string,
): Effect.Effect<CommandOutcome, Error, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor
      const process = yield* executor.start(
        Command.make("bash", "-c", command).pipe(
          Command.workingDirectory(cwd),
          Command.stdout("pipe"),
          Command.stderr("pipe"),
        ),
      )
      const collect = (stream: typeof process.stdout) =>
        stream.pipe(Stream.decodeText(), Stream.mkString)
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [collect(process.stdout), collect(process.stderr), process.exitCode],
        { concurrency: "unbounded" },
      )
      return { status: exitCode, output: `${stdout}${stderr}` }
    }),
  ).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))
