import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer, Stream } from "effect"
import { Cwd } from "./Cwd.js"

/** One command run's outcome: its exit status (a signal death reported as `null`, matching `spawnSync`) and its combined output (stdout then stderr). */
export interface CommandOutcome {
  readonly status: number | null
  readonly output: string
  /** `stdout`/`stderr` captured separately, alongside the merged `output` — additive, for callers (the tRPC router) that need a refusal's three fields distinct rather than flattened into one string. Optional so existing test doubles built from `{ status, output }` alone still satisfy this interface. */
  readonly stdout?: string
  readonly stderr?: string
}

/**
 * The subprocess port: run one shell command in the repo root, wait for it to
 * finish, and get its combined output back as one string (a workflow
 * `script:` is run by the DRIVER, never by gtd). Lets a mode's
 * `format:`/`validate:` command be driven by a scripted double in the
 * `@inmem` e2e tier. `gtd serve`'s loop command is spawned by `Loop.ts`'s own
 * port instead — it needs a per-worktree cwd, a shim-prepended `PATH`, real
 * OS signal control while the child is still running, and never-combined
 * stdout/stderr, none of which this port's single-shot "run to completion"
 * shape supports — so this is no longer the only place gtd itself spawns a
 * subprocess.
 */
export class CommandRunner extends Context.Tag("CommandRunner")<
  CommandRunner,
  {
    /** A SPAWN failure (no `bash`, unreadable cwd) fails the Effect; a non-zero EXIT is a value — how a mode command reports "invalid"/"broken" for the caller to interpret. */
    readonly bash: (command: string) => Effect.Effect<CommandOutcome, Error>
  }
>() {
  /** A test layer over a canned `bash` implementation — no subprocess. */
  static readonly layer = (
    bash: (command: string) => Effect.Effect<CommandOutcome, Error>,
  ): Layer.Layer<CommandRunner> => Layer.succeed(CommandRunner, { bash })

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
                  // A signal death fails process.exitCode; map to null to match spawnSync's contract.
                  process.exitCode.pipe(
                    Effect.map((code): number | null => code),
                    Effect.catchAll(() => Effect.succeed(null)),
                  ),
                ],
                { concurrency: "unbounded" },
              )
              return { status, output: `${stdout}${stderr}`, stdout, stderr }
            }),
          ).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e))))),
      }
    }),
  )
}
