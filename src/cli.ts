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
import { parseCommitPrefix, HUMAN, SEED, FEEDBACK, FIX, type CommitPrefix } from "./services/CommitPrefix.js"
import { inferStep, type InferStepInput, type Step } from "./services/InferStep.js"
import { isOnlyLearningsModified } from "./services/LearningsDiff.js"
import { extractLearnings, hasLearningsSection, hasUncheckedItems } from "./services/Markdown.js"
import { nodeFileOps, type FileOps } from "./services/FileOps.js"
import { learnPrompt, interpolate } from "./prompts/index.js"
import { generateCommitMessage } from "./services/CommitMessage.js"
import { createSpinnerRenderer, isInteractive } from "./services/Renderer.js"
import { QuietMode } from "./services/QuietMode.js"
import { VerboseMode } from "./services/VerboseMode.js"
import { printStartupMessage } from "./services/DecisionTree.js"

export const idleMessage = "Nothing to do. Create a TODO.md or add in-code comments to start."

export interface LearnInput {
  readonly fs: Pick<FileOps, "readFile" | "exists" | "remove">
}

export const learnAction = (input: LearnInput) =>
  Effect.gen(function* () {
    const config = yield* GtdConfigService
    const git = yield* GitService
    const agent = yield* AgentService

    const { isVerbose } = yield* VerboseMode
    const renderer = createSpinnerRenderer(isInteractive(), isVerbose)

    const exists = yield* input.fs.exists()
    if (!exists) {
      renderer.fail(`Plan file ${config.file} not found. Nothing to learn from.`)
      return
    }

    const content = yield* input.fs.readFile()

    const learnings = extractLearnings(content)

    if (hasLearningsSection(content)) {
      if (learnings.trim() !== "") {
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

        const hasChanges = yield* git.hasUncommittedChanges()
        if (hasChanges) {
          const learnDiff = yield* git.getDiff()
          renderer.setTextWithCursor("Generating commit message…")
          const learnCommitMsg = yield* generateCommitMessage("🎓", learnDiff, {
            onStop: () => renderer.stopCursor(),
          })
          renderer.setText("Committing…")
          yield* git.atomicCommit("all", learnCommitMsg)
          renderer.succeed("Learnings persisted to AGENTS.md and committed.")
        } else {
          yield* git.emptyCommit("🎓 learn: no changes")
          renderer.succeed("Agent made no changes. Learn phase complete.")
        }
      } else {
        yield* git.emptyCommit(`🎓 review: no learnings to persist`)
        renderer.succeed("No learnings to persist. Learn phase complete.")
      }

      yield* input.fs.remove()
      yield* git.atomicCommit("all", `🧹 cleanup: remove ${config.file}`)
    } else {
      yield* input.fs.remove()
      yield* git.atomicCommit("all", `🧹 cleanup: remove ${config.file}`)
      renderer.succeed("No learnings to persist. Cleaned up.")
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
    } else if (lastPrefix === HUMAN || lastPrefix === SEED || lastPrefix === FEEDBACK) {
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

    let prevPhasePrefix: CommitPrefix | undefined = undefined
    if (lastPrefix === HUMAN || lastPrefix === FEEDBACK) {
      const messages = yield* git.getCommitMessages(20).pipe(
        Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<string>)),
      )
      for (const msg of messages.slice(1)) {
        const prefix = parseCommitPrefix(msg)
        if (prefix !== undefined && prefix !== HUMAN && prefix !== FEEDBACK && prefix !== FIX) {
          prevPhasePrefix = prefix
          break
        }
      }
    }

    return {
      hasUncommittedChanges: uncommitted,
      lastCommitPrefix: lastPrefix,
      hasUncheckedItems: unchecked,
      onlyLearningsModified,
      todoFileIsNew,
      prevPhasePrefix,
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

const quietOption = Options.boolean("quiet").pipe(
  Options.withAlias("q"),
  Options.withDefault(false),
)

const debugOption = Options.boolean("debug").pipe(Options.withDefault(false))

const verboseOption = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withDefault(false),
)

const rootCommand = Command.make("gtd", { quiet: quietOption, debug: debugOption, verbose: verboseOption }, ({ quiet, debug, verbose }) =>
  Effect.gen(function* () {
    if (debug) process.env.GTD_DEBUG = "1"
    const config = yield* GtdConfigService
    const fs = yield* nodeFileOps(config.file)

    const state = yield* gatherState(fs)
    const step = dispatch(state)

    yield* printStartupMessage(state, step)

    if (step === "commit-feedback") {
      yield* commitFeedbackCommand(fs)
      const newState = yield* gatherState(yield* nodeFileOps(config.file))
      const newStep = dispatch({
        ...newState,
        onlyLearningsModified: state.onlyLearningsModified || newState.onlyLearningsModified,
      })
      yield* runStep(newStep, yield* nodeFileOps(config.file))
    } else {
      yield* runStep(step, fs)
    }
  }).pipe(
    Effect.provide(QuietMode.layer(quiet)),
    Effect.provide(VerboseMode.layer(verbose)),
  ),
)

export const command = rootCommand.pipe(Command.withSubcommands([initCommand]))
