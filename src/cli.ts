import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { makePlanCommand } from "./commands/plan.js"
import { makeBuildCommand } from "./commands/build.js"
import { makeCleanupCommand } from "./commands/cleanup.js"
import { commitFeedbackCommand } from "./commands/commit-feedback.js"
import { initAction } from "./commands/init.js"
import { GitService } from "./services/Git.js"
import { GtdConfigService } from "./services/Config.js"
import { parseCommitPrefix, HUMAN, SEED, FIX, type CommitPrefix } from "./services/CommitPrefix.js"
import { inferStep, type InferStepInput, type Step } from "./services/InferStep.js"
import { hasUncheckedItems } from "./services/Markdown.js"
import { nodeFileOps, type FileOps } from "./services/FileOps.js"
import { QuietMode } from "./services/QuietMode.js"
import { VerboseMode } from "./services/VerboseMode.js"
import { printStartupMessage } from "./services/DecisionTree.js"

export const idleMessage = "Nothing to do. Create a TODO.md or add in-code comments to start."

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
    if (lastPrefix === HUMAN) {
      const messages = yield* git.getCommitMessages(20).pipe(
        Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<string>)),
      )
      for (const msg of messages.slice(1)) {
        const prefix = parseCommitPrefix(msg)
        if (prefix !== undefined && prefix !== HUMAN && prefix !== FIX) {
          prevPhasePrefix = prefix
          break
        }
      }
    }

    return {
      hasUncommittedChanges: uncommitted,
      lastCommitPrefix: lastPrefix,
      hasUncheckedItems: unchecked,
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
      const newStep = dispatch(newState)
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
