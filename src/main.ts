import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { ConfigInit, ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { GitService } from "./Git.js"
import { WorktreeReader } from "./WorktreeReader.js"
import { isEnveloped, makeProgram, runVersionOrHelp } from "./program.js"

// Version/help must short-circuit before the Effect runtime exists: layer
// construction (config load/validation) must never run — nor fail — for
// `gtd --version` / `gtd --help`, in any directory and any repo state.
if (runVersionOrHelp(process.argv, (chunk) => process.stdout.write(chunk))) {
  process.exit(0)
}

makeProgram().pipe(
  Effect.provide(GitService.Live),
  Effect.provide(ConfigService.Live),
  Effect.provide(ConfigInit.Live),
  Effect.provide(WorktreeReader.Live),
  Effect.provide(EnvVars.Live),
  Effect.provide(Cwd.Live),
  Effect.provide(NodeContext.layer),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      // Errors raised before `makeProgram` ran (layer construction — e.g. an
      // invalid config) never passed its `--json` envelope writer; emit the
      // envelope here so `--json` callers always get structured errors.
      if (process.argv.includes("--json") && !isEnveloped(error)) {
        process.stdout.write(JSON.stringify({ state: "error", prompt: error.message }) + "\n")
      }
      process.stderr.write(`gtd: ${error.message ?? String(error)}\n`)
      process.exit(1)
    }),
  ),
  NodeRuntime.runMain,
)
