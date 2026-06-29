import { FileSystem } from "@effect/platform"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { ConfigService } from "./Config.js"
import { GitService, deriveCommitMessage } from "./Git.js"
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
  const loop = (): Effect.Effect<void, Error, GitService | FileSystem.FileSystem | ConfigService> =>
    Effect.suspend(() =>
      Effect.gen(function* () {
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
            const message = action.intent
              ? deriveCommitMessage(action.intent, {
                  ...(action.packageCommitMsg !== undefined ? { packageCommitMsg: action.packageCommitMsg } : {}),
                  ...(action.packageCount !== undefined ? { packageCount: action.packageCount } : {}),
                  ...(action.base !== undefined ? { base: action.base } : {}),
                  ...(action.specReviewNumber !== undefined
                    ? { specReviewNumber: action.specReviewNumber }
                    : {}),
                  verifyIteration: r.context.verifyIterations,
                })
              : action.message
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
          case "approveSpecReview": {
            yield* git.approveSpecReview(action.pkg)
            handle.advance(yield* gatherEvents())
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
      }),
    )

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
