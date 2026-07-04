import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { ConfigService } from "./Config.js"
import { perform } from "./Events.js"
import * as Format from "./Format.js"
import { GitService } from "./Git.js"
import { buildPrompt } from "./Prompt.js"
import { detect, isEdgeOnly } from "./State.js"
import { TestRunner } from "./TestRunner.js"

/**
 * Defensive bound on the auto-advance chain. Each iteration that performs an
 * edge-only action must make progress (a commit / reset / file write that
 * changes what `gatherEvents` sees), so a correct machine reaches a
 * prompt-bearing or STOP state in a handful of hops (longest legitimate chain is
 * ~3: e.g. Transport → Testing → Close package → Building). Exceeding this is a
 * machine/edge bug — fail loudly rather than spin forever.
 */
const MAX_EDGE_HOPS = 100

/**
 * Options for the exported `makeProgram` factory.
 * Defaults to `process.argv` and `process.stdout.write` so production wiring is
 * unchanged.
 */
export interface RunOptions {
  /** argv array (e.g. `["node", "gtd.js", "format", "file.md"]`). Defaults to `process.argv`. */
  argv?: string[]
  /** Sink for stdout output. Defaults to `process.stdout.write.bind(process.stdout)`. */
  write?: (chunk: string) => void
}

/**
 * Factory that returns the gtd driver Effect with the given I/O options.
 *
 * The returned Effect requires `GitService | FileSystem.FileSystem | TestRunner | ConfigService`.
 * Production code calls this with no arguments; the test world supplies an
 * in-memory layer set and captures stdout via the `write` callback.
 *
 * The gtd driver:
 *
 * Default command (no subcommand): loop over the pure resolver. Each turn
 * `detect()` gathers the repo facts and folds them through `resolve()`; if the
 * decision carries an `edgeAction`, `perform` it (commit / reset / run tests /
 * write steering files). When the resolved state is edge-only it auto-advances —
 * re-gather + re-resolve, continuing the deterministic chain WITHIN this one
 * invocation. The loop stops at the first prompt-bearing / human / terminal
 * state (these may still have performed an `edgeAction`, e.g. Fixing commits its
 * pending tree first) and writes that state's single prompt to stdout. The agent
 * reads the prompt, does its turn, and re-runs `gtd`.
 *
 * `format <file>` is the only non-default subcommand (no `gtd transport`
 * command — a `gtd: transport` HEAD is hand-committed by the user and only
 * consumed by the Transport state). Any other subcommand is rejected.
 */
export function makeProgram(
  opts: RunOptions = {},
): Effect.Effect<void, Error, GitService | FileSystem.FileSystem | TestRunner | ConfigService> {
  const argv = opts.argv ?? process.argv
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk))

  // fallow-ignore-next-line complexity
  return Effect.gen(function* () {
    const sub = argv[2]

    if (sub === "format") {
      const args = argv.slice(3).filter((a) => a.length > 0)
      if (args.length === 0) {
        return yield* Effect.fail(new Error("gtd format: missing file path argument"))
      }
      if (args.length > 1) {
        return yield* Effect.fail(
          new Error(`gtd format: too many arguments — expected one path, got: ${args.join(", ")}`),
        )
      }
      yield* Format.formatFile(args[0]!)
      return
    }

    // No escape hatches: gtd takes no command other than `format`. Anything else
    // (e.g. `transport`, `abort`) is rejected rather than silently ignored.
    if (sub !== undefined) {
      return yield* Effect.fail(new Error(`unknown command '${sub}'`))
    }

    const config = yield* ConfigService

    // Everything gtd derives — steering files, diffs, pathspecs — is resolved
    // against the process cwd, so running from anywhere but the repository root
    // would silently mis-derive state. Refuse with a clear error instead. (Fails
    // fast outside a repository too: `--show-toplevel` errors there.) Real paths
    // are compared so symlinked cwds (e.g. macOS /tmp → /private/tmp) match.
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    const topLevel = yield* git.topLevel()
    const topReal = yield* fs.realPath(topLevel)
    const cwdReal = yield* fs.realPath(process.cwd())
    if (topReal !== cwdReal) {
      return yield* Effect.fail(
        new Error(
          `gtd must be run from the repository root (${topLevel}); ` +
            `the current directory is ${process.cwd()}`,
        ),
      )
    }

    // Driver loop: gather → resolve → (perform edgeAction) → auto-advance past
    // edge-only states, else emit the prompt and stop.
    let hops = 0
    while (true) {
      hops += 1
      if (hops > MAX_EDGE_HOPS) {
        return yield* Effect.fail(
          new Error(`edge loop exceeded ${MAX_EDGE_HOPS} hops without reaching a prompt state`),
        )
      }

      const result = yield* detect()

      if (result.edgeAction !== undefined) {
        yield* perform(result.edgeAction)
      }

      // Edge-only states render no prompt — re-gather and re-resolve to continue
      // the deterministic auto-advance chain.
      if (isEdgeOnly(result.state)) {
        continue
      }

      // Prompt-bearing / human / terminal state: emit the single prompt for the
      // result that decided this state (rendered from its pre-perform context).
      write(buildPrompt(result, config.resolveModel))
      return
    }
  })
}
