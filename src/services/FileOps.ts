import { Command, CommandExecutor, FileSystem } from "@effect/platform"
import { Duration, Effect, Stream } from "effect"
import { GitService } from "./Git.js"
import { formatMarkdown } from "./MarkdownFormat.js"
import { findNewlyAddedTodos, removeTodoLines } from "./TodoRemover.js"

export interface FileOps {
  readonly readFile: () => Effect.Effect<string>
  readonly writeFile: (content: string) => Effect.Effect<void>
  readonly exists: () => Effect.Effect<boolean>
  readonly getDiffContent: () => Effect.Effect<string>
  readonly remove: () => Effect.Effect<void>
  readonly readSessionId?: () => Effect.Effect<string | undefined>
  readonly writeSessionId?: (sessionId: string) => Effect.Effect<void>
  readonly deleteSessionFile?: () => Effect.Effect<void>
  readonly formatFile?: () => Effect.Effect<void, Error>
  readonly removeTodosFromDiff?: (diff: string) => Effect.Effect<number, Error>
  readonly runTests?: (cmd: string) => Effect.Effect<{ exitCode: number; output: string }>
}

const sessionFilePath = (_planFilePath: string) => ".git/gtd-session"

export const nodeFileOps = (
  filePath: string,
): Effect.Effect<FileOps, never, FileSystem.FileSystem | GitService | CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const git = yield* GitService
    const executor = yield* CommandExecutor.CommandExecutor
    const sessionPath = sessionFilePath(filePath)
    return {
      readFile: () =>
        fs.readFileString(filePath).pipe(Effect.catchAll(() => Effect.succeed(""))),
      writeFile: (content: string) =>
        fs.writeFileString(filePath, content).pipe(Effect.catchAll(() => Effect.void)),
      exists: () =>
        fs
          .stat(filePath)
          .pipe(
            Effect.map((stat) => stat.size > 0n),
            Effect.catchAll(() => Effect.succeed(false)),
          ),
      getDiffContent: () => git.getDiff().pipe(Effect.catchAll(() => Effect.succeed(""))),
      remove: () => fs.remove(filePath).pipe(Effect.catchAll(() => Effect.void)),
      readSessionId: () =>
        fs
          .exists(sessionPath)
          .pipe(
            Effect.flatMap((exists) =>
              exists
                ? fs
                    .readFileString(sessionPath)
                    .pipe(Effect.map((content) => content.trim() || undefined))
                : Effect.succeed(undefined),
            ),
            Effect.catchAll(() => Effect.succeed(undefined as string | undefined)),
          ),
      writeSessionId: (sessionId: string) =>
        fs.writeFileString(sessionPath, sessionId).pipe(Effect.catchAll(() => Effect.void)),
      deleteSessionFile: () =>
        fs.remove(sessionPath).pipe(Effect.catchAll(() => Effect.void)),
      formatFile: () =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(filePath)
          const formatted = yield* Effect.promise(() => formatMarkdown(content, filePath))
          yield* fs.writeFileString(filePath, formatted)
        }).pipe(Effect.mapError((e) => new Error(String(e)))),
      removeTodosFromDiff: (diff: string) =>
        removeTodoLines(findNewlyAddedTodos(diff, filePath), process.cwd()),
      runTests: (cmd: string) => {
        const parts = cmd.split(" ")
        const [bin, ...args] = parts
        return Effect.gen(function* () {
          const proc = yield* Command.start(
            Command.make(bin!, ...args).pipe(Command.workingDirectory(process.cwd())),
          )
          const [exitCode, stdout, stderr] = yield* Effect.all([
            proc.exitCode,
            proc.stdout.pipe(Stream.decodeText(), Stream.mkString),
            proc.stderr.pipe(Stream.decodeText(), Stream.mkString),
          ], { concurrency: "unbounded" })
          return { exitCode, output: stdout + stderr }
        }).pipe(
          Effect.scoped,
          Effect.timeout(Duration.minutes(5)),
          Effect.catchTag("TimeoutException", () =>
            Effect.succeed({ exitCode: 1, output: "Test process timed out after 5 minutes" }),
          ),
          Effect.catchAll((error) => Effect.succeed({ exitCode: 1, output: String(error) })),
          Effect.provideService(CommandExecutor.CommandExecutor, executor),
        )
      },
    }
  })
