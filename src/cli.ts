import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { makePlanCommand } from "./commands/plan.js"
import { makeBuildCommand } from "./commands/build.js"
import { makeCleanupCommand } from "./commands/cleanup.js"
import { commitFeedbackCommand } from "./commands/commit-feedback.js"
import { initAction } from "./commands/init.js"
import { GitService } from "./services/Git.js"
import { GtdConfigService } from "./services/Config.js"
import { AgentService, catchAgentError } from "./services/Agent.js"
import { parseCommitPrefix, HUMAN } from "./services/CommitPrefix.js"
import { inferStep, type InferStepInput, type Step } from "./services/InferStep.js"
import { isOnlyLearningsModified } from "./services/LearningsDiff.js"
import { extractLearnings, hasLearningsSection, hasUncheckedItems } from "./services/Markdown.js"
import { bunFileOps, type FileOps } from "./services/FileOps.js"
import { learnPrompt, interpolate } from "./prompts/index.js"
import { generateCommitMessage } from "./services/CommitMessage.js"
import { createSpinnerRenderer, isInteractive } from "./services/Renderer.js"
import { notify } from "./services/Notify.js"

export const idleMessage = "Nothing to do. Create a TODO.md or add in-code comments to start."

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

    const learnings = extractLearnings(content)

    if (hasLearningsSection(content) && learnings.trim() !== "") {

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
  }).pipe(catchAgentError)

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
      onlyLearningsModified = isOnlyLearningsModified(diff, committedContent)
    } else if (lastPrefix === HUMAN) {
      // For 🤦 commits, check if the committed diff only modified learnings
      const diff = yield* git.show("HEAD").pipe(
        Effect.catchAll(() => Effect.succeed("")),
      )
      const preCommitContent = yield* git.show(`HEAD~1:${config.file}`).pipe(
        Effect.catchAll(() => Effect.succeed("")),
      )
      onlyLearningsModified = isOnlyLearningsModified(diff, preCommitContent)
    }

    let todoFileIsNew = false
    if (!uncommitted) {
      const inHead = yield* git.show(`HEAD:${config.file}`).pipe(
        Effect.map((out) => out !== ""),
        Effect.catchAll(() => Effect.succeed(false)),
      )
      const inParent = yield* git.show(`HEAD~1:${config.file}`).pipe(
        Effect.map((out) => out !== ""),
        Effect.catchAll(() => Effect.succeed(false)),
      )
      todoFileIsNew = inHead && !inParent
    }

    return {
      hasUncommittedChanges: uncommitted,
      lastCommitPrefix: lastPrefix,
      hasUncheckedItems: unchecked,
      onlyLearningsModified,
      todoFileIsNew,
    }
  })

export const dispatch = (state: InferStepInput) => inferStep(state)

const runStep = (step: Step, fs: FileOps) => {
  switch (step) {
    case "plan":
      return makePlanCommand
    case "build":
      return makeBuildCommand
    case "learn":
      return learnAction({ fs })
    case "cleanup":
      return makeCleanupCommand
    case "idle":
      return Console.log(idleMessage)
    case "commit-feedback":
      return Effect.void
  }
}

const globalOption = Options.boolean("global").pipe(Options.withDefault(false))

export const initCommand = Command.make("init", { global: globalOption }, ({ global }) =>
  initAction({
    cwd: process.cwd(),
    global,
    log: (msg) => console.log(msg),
  }),
)

const rootCommand = Command.make("gtd", {}, () =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const fs = bunFileOps(config.file)

    const state = yield* gatherState(fs)
    const step = dispatch(state)

    if (step === "commit-feedback") {
      yield* commitFeedbackCommand()
      const newState = yield* gatherState(bunFileOps(config.file))
      const newStep = dispatch(newState)
      yield* runStep(newStep, bunFileOps(config.file))
    } else {
      yield* runStep(step, fs)
    }
  }),
)

export const command = rootCommand.pipe(Command.withSubcommands([initCommand]))
