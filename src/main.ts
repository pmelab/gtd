import { FileSystem } from "@effect/platform"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { ConfigService } from "./Config.js"
import { GitService, deriveCommitMessage } from "./Git.js"
import type { CommitMessageInputs } from "./Git.js"
import { gatherEvents } from "./Events.js"
import { startDetect } from "./State.js"
import type { ResolveResult } from "./State.js"
import { TestRunner } from "./TestRunner.js"
import { buildPrompt } from "./Prompt.js"
import type { PromptOverride } from "./Prompt.js"
import * as Format from "./Format.js"

/** Build the PromptOverride from the settled ResolveResult context. */
const overrideFromContext = (r: ResolveResult): PromptOverride | undefined => {
  if (r.value === "fix-tests") {
    return { kind: "fix-tests", testOutput: r.context.testOutput ?? "" }
  }
  if (r.value === "review-process" && r.context.reviewDiff !== undefined) {
    return {
      kind: "review-process",
      reviewDiff: r.context.reviewDiff,
      recordSha: r.context.recordSha ?? "",
    }
  }
  return undefined
}

const program = Effect.gen(function* () {
  const sub = process.argv[2]
  if (sub === "format") {
    const path = process.argv[3]
    if (!path) {
      process.stderr.write("gtd format: missing file path argument\n")
      return
    }
    yield* Format.formatFile(path)
    return
  }
  // No escape hatches: gtd takes no command other than `format`. Anything else
  // (e.g. `abort`, `cancel`) is rejected rather than silently ignored.
  if (sub !== undefined) {
    yield* Effect.fail(new Error(`unknown command '${sub}'`))
  }
  const config = yield* ConfigService
  const git = yield* GitService
  const runner = yield* TestRunner
  const handle = yield* startDetect()

  // Driver loop: ask the machine for an EdgeAction, execute it, re-feed events,
  // repeat until the machine settles with no action — then emit the single prompt.
  // Effect.suspend breaks the recursive type cycle; explicit R annotation fixes inference.
  const loop = (): Effect.Effect<void, Error, GitService | FileSystem.FileSystem> =>
    Effect.suspend(() => Effect.gen(function* () {
      const r = handle.current
      const action = r.edgeAction
      switch (action?.kind) {
        case "removeGtdDir":
          yield* git.removeGtdDir()
          handle.advance(yield* gatherEvents())
          yield* loop()
          break
        case "closeReview": {
          const base = action.base
          if (!base) yield* Effect.fail(new Error("closeReview: missing base ref"))
          yield* git.closeReview(base)
          handle.advance(yield* gatherEvents())
          yield* loop()
          break
        }
        case "commitPending": {
          // The machine passes a FIXED `message` for some intents and leaves it
          // undefined for content-derived ones. Compute the derived message HERE
          // (all reads in the edge) before committing. `pendingCommitIntent` is
          // the intent that produced this dirty tree.
          const intent = r.context.pendingCommitIntent
          let message = action.message
          if (message === undefined && intent !== undefined) {
            const fs = yield* FileSystem.FileSystem
            const inputs: { -readonly [K in keyof CommitMessageInputs]: CommitMessageInputs[K] } =
              {}
            if (intent === "execute") {
              const pkg = r.context.packages[0]
              if (pkg !== undefined && pkg.hasCommitMsg) {
                inputs.packageCommitMsg = yield* fs
                  .readFileString(`.gtd/${pkg.name}/COMMIT_MSG.md`)
                  .pipe(Effect.catchAll(() => Effect.succeed("")))
              }
            } else if (intent === "decompose") {
              inputs.packageCount = r.context.packages.length
            } else if (intent === "human-review") {
              if (r.context.baseRef !== undefined) inputs.base = r.context.baseRef
            } else if (intent === "execute-simple") {
              inputs.todoContent = yield* fs
                .readFileString("TODO.md")
                .pipe(Effect.catchAll(() => Effect.succeed("")))
            } else if (intent === "fix-tests") {
              // The verify counter folds COMMIT events; the next attempt number
              // is the current iteration + 1 (preserves the `Gtd-Test-Fix:` trailer).
              inputs.verifyIteration = r.context.verifyIterations + 1
            }
            message = deriveCommitMessage(intent, inputs)
          }
          yield* git.commitPending({
            ...(message !== undefined ? { message } : {}),
            ...(action.removeLastPackage ? { removeLastPackage: true } : {}),
            ...(action.restorePaths !== undefined ? { restorePaths: action.restorePaths } : {}),
          })
          handle.advance(yield* gatherEvents())
          yield* loop()
          break
        }
        case "runTestGate": {
          const t = yield* runner.run()
          handle.advance([{ type: "TEST_RESULT", exitCode: t.exitCode, output: t.output }])
          yield* loop()
          break
        }
        case "reviewPreRender": {
          const base = action.base
          if (!base) yield* Effect.fail(new Error("reviewPreRender: missing base ref"))
          const rec = yield* git.recordAndRevertReview(base)
          handle.advance([{ type: "REVIEW_RECORDED", diff: rec.diff, recordSha: rec.recordSha }])
          yield* loop()
          break
        }
        default: {
          // No edgeAction: machine has settled (or escalated). Emit the single prompt.
          const prompt = buildPrompt(r, overrideFromContext(r), config.resolveModel)
          process.stdout.write(prompt)
        }
      }
    }))

  yield* loop()
})

program.pipe(
  Effect.provide(GitService.Live),
  Effect.provide(TestRunner.Live),
  // Satisfies `ConfigService`, a requirement of `TestRunner.Live`.
  Effect.provide(ConfigService.Live),
  Effect.provide(NodeContext.layer),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      process.stderr.write(`gtd: ${error.message ?? String(error)}\n`)
      process.exit(1)
    }),
  ),
  NodeRuntime.runMain,
)
