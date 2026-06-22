import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { GitService } from "./Git.js"
import { detect, selectPrompt } from "./State.js"
import { TestRunner } from "./TestRunner.js"
import { buildPrompt } from "./Prompt.js"
import * as Format from "./Format.js"

const program = Effect.gen(function* () {
  if (process.argv[2] === "format") {
    const path = process.argv[3]
    if (!path) {
      process.stderr.write("gtd format: missing file path argument\n")
      return
    }
    yield* Format.formatFile(path)
    return
  }
  const result = yield* detect()

  // Test gate: only the `human-review` leaf runs the suite. Every other leaf
  // (including `format` above) is unchanged and never spawns the runner.
  if (result.value === "human-review") {
    const runner = yield* TestRunner
    const test = yield* runner.run()
    const { result: selected, override } = selectPrompt(result, test)
    const prompt = buildPrompt(selected, override)
    yield* Effect.sync(() => process.stdout.write(prompt))
    return
  }

  const prompt = buildPrompt(result)
  yield* Effect.sync(() => process.stdout.write(prompt))
})

program.pipe(
  Effect.provide(GitService.Live),
  Effect.provide(TestRunner.Live),
  Effect.provide(NodeContext.layer),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      process.stderr.write(`gtd: ${error.message ?? String(error)}\n`)
      process.exit(1)
    }),
  ),
  NodeRuntime.runMain,
)
