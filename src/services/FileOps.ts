import { Command } from "@effect/platform"
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

const sessionFilePath = (planFilePath: string) =>
  planFilePath.replace(/[^/]+$/, ".gtd-session")

export const bunFileOps = (filePath: string): FileOps => ({
  readFile: () =>
    Effect.tryPromise({
      try: () => Bun.file(filePath).text(),
      catch: () => new Error(`Failed to read ${filePath}`),
    }).pipe(Effect.catchAll(() => Effect.succeed(""))),
  exists: () =>
    Effect.tryPromise({
      try: async () => {
        const f = Bun.file(filePath)
        return f.size > 0
      },
      catch: () => false,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),
  getDiffContent: () =>
    Effect.gen(function* () {
      const git = yield* GitService
      return yield* git.getDiff().pipe(Effect.catchAll(() => Effect.succeed("")))
    }),
  remove: () =>
    Effect.tryPromise({
      try: async () => {
        const fs = await import("node:fs/promises")
        await fs.unlink(filePath)
      },
      catch: () => new Error(`Failed to remove ${filePath}`),
    }).pipe(Effect.catchAll(() => Effect.void)),
  readSessionId: () =>
    Effect.tryPromise({
      try: async () => {
        const f = Bun.file(sessionFilePath(filePath))
        if (f.size === 0) return undefined
        const content = await f.text()
        return content.trim() || undefined
      },
      catch: () => undefined as string | undefined,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined as string | undefined))),
  writeSessionId: (sessionId: string) =>
    Effect.tryPromise({
      try: () => Bun.write(sessionFilePath(filePath), sessionId),
      catch: () => new Error(`Failed to write session file`),
    }).pipe(Effect.catchAll(() => Effect.void)),
  deleteSessionFile: () =>
    Effect.tryPromise({
      try: async () => {
        const fs = await import("node:fs/promises")
        await fs.unlink(sessionFilePath(filePath))
      },
      catch: () => new Error(`Failed to delete session file`),
    }).pipe(Effect.catchAll(() => Effect.void)),
  formatFile: () =>
    Command.make("prettier", "--write", filePath).pipe(
      Command.string,
      Effect.asVoid,
      Effect.mapError((e) => new Error(String(e))),
    ),
})
