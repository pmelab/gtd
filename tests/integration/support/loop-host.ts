import { Effect, Layer } from "effect"
import { LoopHost } from "../../../src/loop/index.js"

interface Ran {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * The loop's host in memory: files outside the repository from `files`, by
 * absolute path, and processes answered by `run` — absent, none runs. A
 * `stopAt` match ends the output at that line, as the live host's kill does.
 */
export const inMemoryLoopHost = (
  files: ReadonlyMap<string, string>,
  env: Readonly<Record<string, string | undefined>> = {},
  run?: (command: string, args: readonly string[]) => Ran,
): Layer.Layer<LoopHost> =>
  Layer.succeed(LoopHost, {
    env,
    color: false,
    spawn: (request) => {
      if (run === undefined) {
        return Effect.fail(new Error(`could not run ${request.command}: no processes in memory`))
      }
      const ran = run(request.command, request.args)
      const lines = ran.stdout.split("\n")
      const at = request.stopAt === undefined ? -1 : lines.slice(0, -1).findIndex(request.stopAt)
      return Effect.succeed(
        at === -1
          ? ran
          : {
              code: 143,
              stdout: `${lines.slice(0, at + 1).join("\n")}\n`,
              stderr: "",
              stopped: true,
            },
      )
    },
    readFile: (path) => Effect.succeed(files.get(path)),
    resetLog: () => Effect.void,
    appendLog: () => Effect.void,
    say: () => Effect.void,
  })
