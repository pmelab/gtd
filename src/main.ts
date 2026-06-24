import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { ConfigService } from "./Config.js"
import { GitService } from "./Git.js"
import { startDetect } from "./State.js"
import { TestRunner } from "./TestRunner.js"
import { buildPrompt } from "./Prompt.js"
import * as Format from "./Format.js"

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
  const handle = yield* startDetect()
  let result = handle.current

  // The machine owns the decision tree; the edge only performs the side effect
  // each settled `edgeAction` requests, then advances the SAME actor with the
  // result event so the machine re-projects the next state.
  const action = result.edgeAction
  if (action?.kind === "reviewPreRender") {
    // Review-process pre-render: record + revert REVIEW.md, feed it back.
    const git = yield* GitService
    const { diff, recordSha } = yield* git.recordAndRevertReview(action.base)
    result = handle.advance([{ type: "REVIEW_RECORDED", diff, recordSha }])
  } else if (action?.kind === "runTestGate") {
    // Test gate (execute only): run the suite, feed the exit code back. The
    // machine folds green→execute / red<cap→fix-tests / red≥cap→escalate.
    const runner = yield* TestRunner
    const test = yield* runner.run()
    result = handle.advance([{ type: "TEST_RESULT", exitCode: test.exitCode, output: test.output }])
  }

  // Map any machine-carried render data back onto the buildPrompt override
  // contract (Prompt.ts is unchanged; the data now lives on the context).
  const override =
    result.value === "review-process" && result.context.reviewDiff !== undefined
      ? ({
          kind: "review-process" as const,
          reviewDiff: result.context.reviewDiff,
          recordSha: result.context.recordSha ?? "",
        })
      : result.value === "fix-tests"
        ? ({ kind: "fix-tests" as const, testOutput: result.context.testOutput ?? "" })
        : undefined

  const prompt = buildPrompt(result, override, config.resolveModel)
  yield* Effect.sync(() => process.stdout.write(prompt))
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
