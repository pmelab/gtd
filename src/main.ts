import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { GitService } from "./Git.js"
import { detect, selectPrompt } from "./State.js"
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
  const result = yield* detect()

  // Test gate: only these leaves run the suite before emitting a prompt. The
  // `selectPrompt` helper + cap check are leaf-agnostic, so adding a future
  // gated leaf is just a matter of extending this set. Every other leaf
  // (including `format` above) is unchanged and never spawns the runner.
  // `execute` is REQUIRED here: the machine checks `hasPackages` before
  // `capReached`, so without the edge cap a failing-test package would loop
  // forever.
  const TEST_GATED_LEAVES = new Set<string>(["human-review", "execute"])
  if (TEST_GATED_LEAVES.has(result.value)) {
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
