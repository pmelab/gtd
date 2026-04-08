import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { nodeFileOps, type FileOps } from "../services/FileOps.js"
import { generateCleanupMessage } from "../services/CleanupMessage.js"
import { AgentService } from "../services/Agent.js"
import { parseCommitPrefix } from "../services/CommitPrefix.js"
import { SEED, GRILL, GRILL_ANSWER } from "../services/CommitPrefix.js"

export interface CleanupInput {
  readonly fs: Pick<FileOps, "remove" | "exists">
}

const COMMIT_LOOKBACK = 100

const gatherWorkflowHistory = Effect.gen(function* () {
  const git = yield* GitService
  const commits = yield* git.getCommitLog(COMMIT_LOOKBACK)

  const seedIndex = commits.findIndex((c) => parseCommitPrefix(c.subject) === SEED)
  if (seedIndex === -1) return { seedDiff: "", grillDiffs: [] as string[] }

  // commits[0] is newest; slice from HEAD down to (and including) the seed
  const workflowCommits = commits.slice(0, seedIndex + 1).reverse()

  const seedCommit = workflowCommits.find((c) => parseCommitPrefix(c.subject) === SEED)!
  const seedDiff = yield* git.show(seedCommit.hash)

  const grillCommits = workflowCommits.filter((c) => {
    const prefix = parseCommitPrefix(c.subject)
    return prefix === GRILL || prefix === GRILL_ANSWER
  })
  const grillDiffs = yield* Effect.all(grillCommits.map((c) => git.show(c.hash)))

  return { seedDiff, grillDiffs: grillDiffs as string[] }
})

export const cleanupCommand = (input: CleanupInput) =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService

    const exists = yield* input.fs.exists()
    if (!exists) {
      return
    }

    yield* input.fs.remove()

    const { seedDiff, grillDiffs } = yield* gatherWorkflowHistory

    const message =
      seedDiff.length > 0
        ? yield* generateCleanupMessage(seedDiff, grillDiffs)
        : `refactor: remove ${config.file}`

    yield* git.atomicCommit("all", message)
  })

export const makeCleanupCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  return yield* cleanupCommand({ fs: yield* nodeFileOps(config.file) })
})
