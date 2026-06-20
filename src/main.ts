import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { GitService } from "./Git.js"
import { detect } from "./State.js"
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
  const refArg = process.argv[2]
  const state = yield* detect(refArg)
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
