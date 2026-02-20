import { Command, CommandExecutor, FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { GitService } from "./Git.js"

export interface FileOps {
  readonly readFile: () => Effect.Effect<string>
  readonly exists: () => Effect.Effect<boolean>
  readonly getDiffContent: () => Effect.Effect<string>
  readonly remove: () => Effect.Effect<void>
  readonly readSessionId?: () => Effect.Effect<string | undefined>
  readonly writeSessionId?: (sessionId: string) => Effect.Effect<void>
  readonly deleteSessionFile?: () => Effect.Effect<void>
  readonly formatFile?: () => Effect.Effect<void, Error>
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
        Command.make("prettier", "--write", filePath).pipe(
          Command.string,
          Effect.asVoid,
          Effect.mapError((e) => new Error(String(e))),
          Effect.provideService(CommandExecutor.CommandExecutor, executor),
        ),
    }
  })
