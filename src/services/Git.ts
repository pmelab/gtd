import { Command, CommandExecutor } from "@effect/platform"
import { Context, Effect, Layer } from "effect"

export interface GitOperations {
  readonly getDiff: () => Effect.Effect<string, Error>
  readonly hasUnstagedChanges: () => Effect.Effect<boolean, Error>
  readonly hasUncommittedChanges: () => Effect.Effect<boolean, Error>
  readonly getLastCommitMessage: () => Effect.Effect<string, Error>
  readonly getCommitMessages: (n: number) => Effect.Effect<ReadonlyArray<string>, Error>
  readonly add: (files: ReadonlyArray<string>) => Effect.Effect<void, Error>
  readonly addAll: () => Effect.Effect<void, Error>
  readonly commit: (message: string) => Effect.Effect<void, Error>
  readonly emptyCommit: (message: string) => Effect.Effect<void, Error>
  readonly show: (ref: string) => Effect.Effect<string, Error>
  readonly atomicCommit: (
    files: ReadonlyArray<string> | "all",
    message: string,
  ) => Effect.Effect<void, Error>
  readonly stageByPatch: (patch: string) => Effect.Effect<void, Error>
}

const run = (
  ...args: [string, ...Array<string>]
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Command.make(...args).pipe(
    Command.string,
    Effect.map((s) => s.trim()),
    Effect.mapError((e) => new Error(String(e))),
  )

const runWithStdin = (
  input: string,
  ...args: [string, ...Array<string>]
): Effect.Effect<string, Error, CommandExecutor.CommandExecutor> =>
  Command.make(...args).pipe(
    Command.feed(input),
    Command.string,
    Effect.map((s) => s.trim()),
    Effect.mapError((e) => new Error(String(e))),
  )

export class GitService extends Context.Tag("GitService")<GitService, GitOperations>() {
  static Live = Layer.effect(
    GitService,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor
      const exec = (...args: [string, ...Array<string>]) =>
        run(...args).pipe(Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)))
      const execWithStdin = (input: string, ...args: [string, ...Array<string>]) =>
        runWithStdin(input, ...args).pipe(
          Effect.provide(Layer.succeed(CommandExecutor.CommandExecutor, executor)),
        )

      return {
        getDiff: () =>
          Effect.gen(function* () {
            // Find untracked files so they appear in the diff
            const untrackedRaw = yield* exec(
              "git",
              "ls-files",
              "--others",
              "--exclude-standard",
            )
            const untrackedFiles =
              untrackedRaw === ""
                ? []
                : untrackedRaw.split("\n").filter((f) => f !== "")

            const getUnstagedDiff = () =>
              untrackedFiles.length === 0
                ? exec("git", "diff")
                : Effect.acquireUseRelease(
                    exec("git", "add", "--intent-to-add", ...untrackedFiles),
                    () => exec("git", "diff"),
                    () =>
                      exec("git", "reset", "--", ...untrackedFiles).pipe(
                        Effect.catchAll(() => Effect.void),
                      ),
                  )

            const unstaged = yield* getUnstagedDiff()
            const staged = yield* exec("git", "diff", "--cached")
            const combined = [unstaged, staged].filter((s) => s !== "").join("\n")
            if (combined !== "") return combined
            return yield* exec("git", "diff", "HEAD~1")
          }),

        hasUnstagedChanges: () =>
          exec("git", "diff", "--quiet").pipe(
            Effect.map((output) => output !== ""),
            Effect.catchAll(() => Effect.succeed(true)),
          ),

        hasUncommittedChanges: () =>
          exec("git", "status", "--porcelain").pipe(
            Effect.map((output) => output !== ""),
          ),

        getLastCommitMessage: () =>
          exec("git", "log", "-1", "--pretty=%s"),

        getCommitMessages: (n) =>
          exec("git", "log", `-${n}`, "--pretty=%s").pipe(
            Effect.map((out) => (out === "" ? [] : out.split("\n"))),
          ),

        add: (files) => exec("git", "add", ...files).pipe(Effect.asVoid),

        addAll: () => exec("git", "add", "-A").pipe(Effect.asVoid),

        commit: (message) => exec("git", "commit", "-m", message).pipe(Effect.asVoid),

        emptyCommit: (message) =>
          exec("git", "commit", "--allow-empty", "-m", message).pipe(Effect.asVoid),

        show: (ref) => exec("git", "show", ref),

        atomicCommit: (files, message) =>
          Effect.uninterruptible(
            Effect.gen(function* () {
              if (files === "all") {
                yield* exec("git", "add", "-A")
              } else {
                yield* exec("git", "add", ...files)
              }
              yield* exec("git", "commit", "-m", message).pipe(
                Effect.catchAll((commitError) =>
                  exec("git", "reset", "HEAD").pipe(
                    Effect.catchAll(() => Effect.void),
                    Effect.andThen(Effect.fail(commitError)),
                  ),
                ),
              )
            }),
          ),

        stageByPatch: (patch) =>
          execWithStdin(patch, "git", "apply", "--cached").pipe(Effect.asVoid),
      }
    }),
  )
}
