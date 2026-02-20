import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { nodeFileOps, type FileOps } from "../services/FileOps.js"

export interface CleanupInput {
  readonly fs: Pick<FileOps, "remove" | "exists">
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

export const makeCleanupCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  return yield* cleanupCommand({ fs: yield* nodeFileOps(config.file) })
})
