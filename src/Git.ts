import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer } from "effect"

export interface GitOperations {
  readonly statusPorcelain: () => Effect.Effect<string, Error>
  readonly diffHead: () => Effect.Effect<string, Error>
  readonly lastCommitSubject: () => Effect.Effect<string, Error>
  readonly lastCommitFiles: () => Effect.Effect<ReadonlyArray<string>, Error>
  readonly hasCommits: () => Effect.Effect<boolean, Error>
}

const run = (
  ...args: [string, ...Array<string>]
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Command.make(...args).pipe(
    Command.string,
    Effect.mapError((e) => new Error(String(e))),
  )

export class GitService extends Context.Tag("GitService")<GitService, GitOperations>() {
  static Live = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor
      const exec = (...args: [string, ...Array<string>]) =>
        run(...args).pipe(
          Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
        )

      return {
        statusPorcelain: () => exec("git", "status", "--porcelain"),

        diffHead: () =>
          Effect.gen(function* () {
            const untrackedRaw = yield* exec(
              "git",
              "ls-files",
              "--others",
              "--exclude-standard",
            )
            const untracked = untrackedRaw
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s !== "")
            if (untracked.length === 0) return yield* exec("git", "diff", "HEAD")
            yield* exec("git", "add", "--intent-to-add", "--", ...untracked)
            const diff = yield* exec("git", "diff", "HEAD")
            yield* exec("git", "reset", "--", ...untracked).pipe(
              Effect.catchAll(() => Effect.void),
            )
            return diff
          }),

        lastCommitSubject: () =>
          exec("git", "log", "-1", "--pretty=%s").pipe(Effect.map((s) => s.trim())),

        lastCommitFiles: () =>
          exec("git", "show", "--name-only", "--pretty=", "HEAD").pipe(
            Effect.map((out) =>
              out
                .split("\n")
                .map((s) => s.trim())
                .filter((s) => s !== ""),
            ),
          ),

        hasCommits: () =>
          exec("git", "rev-parse", "--verify", "HEAD").pipe(
            Effect.map(() => true),
            Effect.catchAll(() => Effect.succeed(false)),
          ),
      }
    }),
  )
}
