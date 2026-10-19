import { Effect, Layer } from "effect"
import { LoopHost } from "../../../src/loop/index.js"

/**
 * The loop's host in memory: files outside the repository from `files`, by
 * absolute path. It runs no process — an in-memory scenario drives the loop's
 * hook, never a whole loop.
 */
export const inMemoryLoopHost = (
  files: ReadonlyMap<string, string>,
  env: Readonly<Record<string, string | undefined>> = {},
): Layer.Layer<LoopHost> =>
  Layer.succeed(LoopHost, {
    env,
    color: false,
    spawn: (request) =>
      Effect.fail(new Error(`could not run ${request.command}: no processes in memory`)),
    readFile: (path) => Effect.succeed(files.get(path)),
    resetLog: () => Effect.void,
    appendLog: () => Effect.void,
    say: () => Effect.void,
  })
