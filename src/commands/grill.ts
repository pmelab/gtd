import chalk from "chalk"
import { Effect } from "effect"
import { resolve } from "node:path"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService, catchAgentError } from "../services/Agent.js"
import { grillPrompt, interpolate } from "../prompts/index.js"
import { createSpinnerRenderer, isInteractive } from "../services/Renderer.js"
import type { FileOps } from "../services/FileOps.js"
import { nodeFileOps } from "../services/FileOps.js"
import { VerboseMode } from "../services/VerboseMode.js"

export const grillCommand = (fs: FileOps) =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService
    const agent = yield* AgentService

    const { isVerbose } = yield* VerboseMode
    const renderer = createSpinnerRenderer(isInteractive(), isVerbose)

    // 1. If uncommitted changes, those are user answers — commit them
    const hasUncommitted = yield* git.hasUncommittedChanges()
    if (hasUncommitted) {
      renderer.setText("Committing answers...")
      yield* git.atomicCommit("all", "🤓 answers")
    }

    // 2. Read TODO.md for context
    const content = yield* fs.readFile()
    const filePath = resolve(process.cwd(), config.file)

    // 3. Compose prompt
    const planSection = `### Current TODO.md (${filePath})\n\n\`\`\`markdown\n${content}\n\`\`\``
    const prompt = interpolate(grillPrompt, { plan: planSection })

    // 4. Load previous session for continuity
    let previousSessionId: string | undefined
    if (fs.readSessionId) {
      previousSessionId = yield* fs.readSessionId()
    }

    // 5. Invoke agent
    renderer.setTextWithCursor(chalk.cyan("Grilling..."))
    const grillResult = yield* agent
      .invoke({
        prompt,
        systemPrompt: "",
        mode: "plan",
        cwd: process.cwd(),
        onEvent: renderer.onEvent,
        ...(previousSessionId ? { resumeSessionId: previousSessionId } : {}),
      })
      .pipe(Effect.ensuring(Effect.sync(() => renderer.dispose())))
    const sessionId = grillResult.sessionId

    // 6. Format file
    if (fs.formatFile) {
      yield* fs.formatFile().pipe(Effect.catchAll(() => Effect.void))
    }

    // 7. Commit questions (or empty commit if agent made no changes)
    const hasChanges = yield* git.hasUncommittedChanges()
    if (hasChanges) {
      yield* git.atomicCommit("all", "🔍 grill: questions")
    } else {
      yield* git.emptyCommit("🔍 grill: questions")
    }

    // 8. Save session ID for continuity
    if (sessionId && fs.writeSessionId) {
      yield* fs.writeSessionId(sessionId)
    }
  }).pipe(catchAgentError)

export const makeGrillCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  return yield* grillCommand(yield* nodeFileOps(config.file))
})
