import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { ConfigService } from "./Config.js"
import { GitService } from "./Git.js"
import { TestRunner } from "./TestRunner.js"
import { makeProgram } from "./program.js"

makeProgram().pipe(
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
