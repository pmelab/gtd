import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { GitService } from "./Git.js"
import { detect } from "./State.js"
import { buildPrompt } from "./Prompt.js"

const program = Effect.gen(function* () {
  const state = yield* detect()
  const prompt = buildPrompt(state)
  yield* Effect.sync(() => process.stdout.write(prompt))
})

program.pipe(
  Effect.provide(GitService.Live),
  Effect.provide(NodeContext.layer),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      process.stderr.write(`gtd: ${error.message ?? String(error)}\n`)
      process.exit(1)
    }),
  ),
  NodeRuntime.runMain,
)
