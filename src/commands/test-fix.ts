import chalk from "chalk"
import { Effect } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService, catchAgentError } from "../services/Agent.js"
import { generateCommitMessage } from "../services/CommitMessage.js"
import { createSpinnerRenderer, isInteractive } from "../services/Renderer.js"
import { nodeFileOps, type FileOps } from "../services/FileOps.js"
import { VerboseMode } from "../services/VerboseMode.js"

/**
 * Runs tests and, if they fail, loops with the agent to fix them.
 * Commits fixes with the 🔨 prefix.
 *
 * Returns true if any commits were made (caller should re-dispatch),
 * false if tests already passed or no testCmd is configured (caller
 * should run the natural continuation directly).
 */
export const testFixCommand = (fs: FileOps): Effect.Effect<
  boolean,
  Error,
  GtdConfigService | GitService | AgentService | VerboseMode
> =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService
    const agent = yield* AgentService
    const { isVerbose } = yield* VerboseMode
    const renderer = createSpinnerRenderer(isInteractive(), isVerbose)

    const testFn = fs.runTests
    if (config.testCmd.trim() === "" || !testFn) {
      return false
    }

    renderer.setText("Running tests…")
    const initialResult = yield* testFn(config.testCmd)

    if (initialResult.exitCode === 0) {
      renderer.dispose()
      return false
    }

    // Tests are failing — enter fix loop
    let madeCommits = false
    let currentTestOutput = initialResult.output
    let retrySessionId: string | undefined

    for (let retry = 0; retry <= config.testRetries; retry++) {
      const testResult =
        retry === 0
          ? initialResult
          : yield* testFn(config.testCmd)

      if (testResult.exitCode === 0) {
        break
      }

      currentTestOutput = testResult.output
      process.stderr.write(chalk.red(currentTestOutput) + "\n")

      if (retry >= config.testRetries) {
        renderer.fail(`Tests still failing after ${config.testRetries + 1} attempts.`)
        yield* Effect.sync(() => (process.exitCode = 1))
        return madeCommits
      }

      renderer.setTextWithCursor(chalk.rgb(255, 165, 0)("Fixing…"))
      const prompt = `Tests failed:\n\`\`\`\n${currentTestOutput}\n\`\`\`\nFix the failures.`
      const fixResult = yield* agent
        .invoke({
          prompt,
          systemPrompt: "",
          mode: "build",
          cwd: process.cwd(),
          onEvent: renderer.onEvent,
          ...(retrySessionId ? { resumeSessionId: retrySessionId } : {}),
        })
        .pipe(Effect.ensuring(Effect.void))

      retrySessionId = fixResult.sessionId

      const diff = yield* git.getDiff()
      if (diff.trim() !== "") {
        renderer.setTextWithCursor("Generating commit message…")
        const commitMsg = yield* generateCommitMessage("🔨", diff, {
          onStop: () => renderer.stopCursor(),
        })
        yield* git.atomicCommit("all", commitMsg)
        madeCommits = true
      }
    }

    renderer.dispose()
    return madeCommits
  }).pipe(catchAgentError)

export const makeTestFixCommand = Effect.gen(function* () {
  const config = yield* GtdConfigService
  return yield* testFixCommand(yield* nodeFileOps(config.file))
})
