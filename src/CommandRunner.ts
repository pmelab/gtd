import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Stream } from "effect"
import { Cwd } from "./Cwd.js"

/** One command run's outcome: its exit status (a signal death reported as `null`, matching `spawnSync`) and its combined output (stdout then stderr). */
export interface CommandOutcome {
  readonly status: number | null
  readonly output: string
}

/**
 * The subprocess port: run one shell command in the repo root. Replaces
 * `SteeringMode.ts`'s private `spawnSync` call so a mode's `format:`/
 * `validate:` command can be driven by a scripted double in the `@inmem` e2e
 * tier — the only place gtd itself spawns a subprocess (a workflow `script:`
 * is run by the DRIVER, never by gtd).
 */
export class CommandRunner extends Context.Tag("CommandRunner")<
  CommandRunner,
  {
    /**
     * `bash -c <command>` in the repo root. A SPAWN failure (no `bash`, an
     * unreadable cwd) fails the Effect; a non-zero EXIT is a value — that is
     * how a mode command says "invalid" (`validate:`) or "broken" (`format:`),
     * for the caller to interpret.
     */
    readonly bash: (command: string) => Effect.Effect<CommandOutcome, Error>
  }
>() {
  static Live = Layer.effect(
    CommandRunner,
    Effect.gen(function* () {
      const { root } = yield* Cwd
      const executor = yield* CommandExecutor.CommandExecutor
      return {
        bash: (command: string) =>
          Effect.scoped(
            Effect.gen(function* () {
              const process = yield* executor.start(
                Command.make("bash", "-c", command).pipe(
                  Command.workingDirectory(root),
                  Command.stdout("pipe"),
                  Command.stderr("pipe"),
                ),
              )
              const collect = (stream: typeof process.stdout) =>
                stream.pipe(Stream.decodeText(), Stream.mkString)
              const [stdout, stderr, status] = yield* Effect.all(
                [
                  collect(process.stdout),
                  collect(process.stderr),
                  // A signal death (e.g. `kill -9`) fails `process.exitCode`
                  // rather than resolving to `null` the way `spawnSync` did —
                  // mapped back to `null` here so `CommandOutcome.status`
                  // keeps `spawnSync`'s contract for every caller.
                  process.exitCode.pipe(
                    Effect.map((code): number | null => code),
                    Effect.catchAll(() => Effect.succeed(null)),
                  ),
                ],
                { concurrency: "unbounded" },
              )
              return { status, output: `${stdout}${stderr}` }
            }),
          ).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e))))),
      }
    }),
  )
}
