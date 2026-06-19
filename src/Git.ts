import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer } from "effect"

export interface GitOperations {
  readonly statusPorcelain: () => Effect.Effect<string, Error>
  readonly diffHead: () => Effect.Effect<string, Error>
  readonly lastCommitSubject: () => Effect.Effect<string, Error>
  readonly lastCommitFiles: () => Effect.Effect<ReadonlyArray<string>, Error>
  readonly hasCommits: () => Effect.Effect<boolean, Error>
  readonly diffRef: (ref: string) => Effect.Effect<string, Error>
  readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
  readonly checkoutTracked: () => Effect.Effect<void, Error>
  readonly cleanUntracked: () => Effect.Effect<void, Error>
  readonly diffStatRef: (ref: string) => Effect.Effect<string, Error>
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

        diffRef: (ref: string) => exec("git", "diff", ref, "HEAD"),

        resolveRef: (ref: string) =>
          exec("git", "rev-parse", ref).pipe(Effect.map((s) => s.trim())),

        checkoutTracked: () =>
          exec("git", "checkout", "--", ".").pipe(Effect.map(() => undefined as void)),

        cleanUntracked: () =>
          exec("git", "clean", "-fd").pipe(Effect.map(() => undefined as void)),

        diffStatRef: (ref: string) => exec("git", "diff", "--stat", ref, "HEAD"),
      }
    }),
  )
}
