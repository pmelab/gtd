import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"

interface FileOps {
  readonly remove: () => Effect.Effect<void>
  readonly exists: () => Effect.Effect<boolean>
}

export interface CleanupInput {
  readonly fs: FileOps
}

export const cleanupCommand = (input: CleanupInput) =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService

    const exists = yield* input.fs.exists()
    if (!exists) {
      return
    }

    yield* input.fs.remove()
    yield* git.atomicCommit("all", `🧹 cleanup: remove ${config.file}`)
  })

const bunFileOps = (filePath: string): FileOps => ({
  exists: () =>
    Effect.tryPromise({
      try: async () => {
        const f = Bun.file(filePath)
        return f.size > 0
      },
      catch: () => false,
    }).pipe(Effect.catchAll(() => Effect.succeed(false))),
  remove: () =>
    Effect.tryPromise({
      try: async () => {
        const fs = await import("node:fs/promises")
        await fs.unlink(filePath)
      },
      catch: () => new Error(`Failed to remove ${filePath}`),
    }).pipe(Effect.catchAll(() => Effect.void)),
})

export const makeCleanupCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  return yield* cleanupCommand({ fs: bunFileOps(config.file) })
})
