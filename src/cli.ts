import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import { makePlanCommand } from "./commands/plan.js"
import { makeBuildCommand } from "./commands/build.js"
import { makeCleanupCommand } from "./commands/cleanup.js"
import { commitFeedbackCommand } from "./commands/commit-feedback.js"
import { GitService } from "./services/Git.js"
import { GtdConfigService } from "./services/Config.js"
import { AgentService, AgentError } from "./services/Agent.js"
import { parseCommitPrefix, HUMAN } from "./services/CommitPrefix.js"
import { inferStep, type InferStepInput, type Step } from "./services/InferStep.js"
import { hasUncheckedItems } from "./services/TodoState.js"
import { isOnlyLearningsModified as checkOnlyLearnings } from "./services/LearningsDiff.js"
import { extractLearnings, hasLearningsSection } from "./services/Markdown.js"
import { learnPrompt, interpolate } from "./prompts/index.js"
import { generateCommitMessage } from "./services/CommitMessage.js"
import { createSpinnerRenderer, isInteractive } from "./services/Renderer.js"
import { notify } from "./services/Notify.js"

export const idleMessage = "Nothing to do. Create a TODO.md or add in-code comments to start."

export interface DispatchResult {
  readonly step: Step
}

interface FileOps {
  readonly readFile: () => Effect.Effect<string>
  readonly exists: () => Effect.Effect<boolean>
  readonly getDiffContent: () => Effect.Effect<string>
  readonly remove: () => Effect.Effect<void>
}

export interface LearnInput {
  readonly fs: Pick<FileOps, "readFile" | "exists" | "remove">
}

export const learnAction = (input: LearnInput) =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService
    const agent = yield* AgentService

    const renderer = createSpinnerRenderer(isInteractive())

    const exists = yield* input.fs.exists()
    if (!exists) {
      renderer.fail(`Plan file ${config.file} not found. Nothing to learn from.`)
      return
    }

    const content = yield* input.fs.readFile()

    if (hasLearningsSection(content) && extractLearnings(content).trim() !== "") {
      const learnings = extractLearnings(content)

      renderer.setText("Persisting learnings to AGENTS.md...")

      const prompt = interpolate(learnPrompt, {
        learnings: learnings,
      })

      yield* agent
        .invoke({
          prompt,
          systemPrompt: "",
          mode: "learn",
          cwd: process.cwd(),
          onEvent: renderer.onEvent,
        })
        .pipe(Effect.ensuring(Effect.sync(() => renderer.dispose())))

      const learnDiff = yield* git.getDiff()
      const learnCommitMsg = yield* generateCommitMessage("🎓", learnDiff)
      yield* git.atomicCommit("all", learnCommitMsg)
      renderer.succeed("Learnings persisted to AGENTS.md and committed.")

      yield* input.fs.remove()
      yield* git.atomicCommit("all", `🧹 cleanup: remove ${config.file}`)
      yield* notify("gtd", "Learnings committed and cleaned up.")
    } else {
      yield* input.fs.remove()
      yield* git.atomicCommit("all", `🧹 cleanup: remove ${config.file}`)
      renderer.succeed("No learnings to persist. Cleaned up.")
      yield* notify("gtd", "Skipped learnings, cleaned up.")
    }
  }).pipe(
    Effect.catchAll((err) => {
      if (err instanceof AgentError) {
        if (err.reason === "inactivity_timeout") {
          console.error(`[gtd] Agent timed out (no activity)`)
          return Effect.void
        }
        if (err.reason === "input_requested") {
          console.error(`[gtd] Agent requested user input, aborting`)
          return Effect.void
        }
      }
      return Effect.fail(err)
    }),
  )

export const gatherState = (
  fs: FileOps,
): Effect.Effect<InferStepInput, Error, GitService | GtdConfigService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* GtdConfigService

    const uncommitted = yield* git.hasUncommittedChanges()
    const lastMsg = yield* git.getLastCommitMessage().pipe(
      Effect.catchAll(() => Effect.succeed("")),
    )
    const lastPrefix = parseCommitPrefix(lastMsg)

    const fileExists = yield* fs.exists()
    const content = fileExists ? yield* fs.readFile() : ""
    const unchecked = hasUncheckedItems(content)

    let onlyLearningsModified = false
    if (uncommitted) {
      const diff = yield* fs.getDiffContent()
      const committedContent = yield* git.show(`HEAD:${config.file}`).pipe(
        Effect.catchAll(() => Effect.succeed("")),
      )
      onlyLearningsModified = checkOnlyLearnings(diff, committedContent)
    } else if (lastPrefix === HUMAN) {
      // For 🤦 commits, check if the committed diff only modified learnings
      const diff = yield* git.show("HEAD").pipe(
        Effect.catchAll(() => Effect.succeed("")),
      )
      const preCommitContent = yield* git.show(`HEAD~1:${config.file}`).pipe(
        Effect.catchAll(() => Effect.succeed("")),
      )
      onlyLearningsModified = checkOnlyLearnings(diff, preCommitContent)
    }

    return {
      hasUncommittedChanges: uncommitted,
      lastCommitPrefix: lastPrefix,
      hasUncheckedItems: unchecked,
      onlyLearningsModified,
    }
  })

export const dispatch = (state: InferStepInput): DispatchResult => {
  const step = inferStep(state)
  return { step }
}

const bunFileOps = (filePath: string): FileOps => ({
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
})

export const command = Command.make("gtd", {}, () =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const fs = bunFileOps(config.file)

    const state = yield* gatherState(fs)
    const result = dispatch(state)

    switch (result.step) {
      case "plan":
        yield* makePlanCommand
        break
      case "build":
        yield* makeBuildCommand
        break
      case "learn":
        yield* learnAction({
          fs: bunFileOps(config.file),
        })
        break
      case "cleanup":
        yield* makeCleanupCommand
        break
      case "commit-feedback": {
        yield* commitFeedbackCommand()
        // Re-dispatch after committing feedback
        const newState = yield* gatherState(bunFileOps(config.file))
        const newResult = dispatch(newState)
        switch (newResult.step) {
          case "plan":
            yield* makePlanCommand
            break
          case "learn":
            yield* learnAction({
              fs: bunFileOps(config.file),
            })
            break
          case "build":
            yield* makeBuildCommand
            break
          case "cleanup":
            yield* makeCleanupCommand
            break
          case "idle":
            yield* Console.log(idleMessage)
            break
        }
        break
      }
      case "idle":
        yield* Console.log(idleMessage)
        break
    }
  }),
)
