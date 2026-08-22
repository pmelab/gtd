import type { CliIo } from "../Cli.js"
import type { InMemRepo } from "./InMemRepo.js"
import { testLayers, type ScriptedCommand } from "./Layers.js"

export interface CapturedCliResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export const makeCapturingCliIo = (
  repo: InMemRepo,
  env: Readonly<Record<string, string | undefined>> = {},
  commands: ReadonlyMap<string, ScriptedCommand> = new Map(),
): { readonly io: CliIo; readonly result: () => CapturedCliResult } => {
  let stdout = ""
  let stderr = ""
  let exitCode = 0
  const io: CliIo = {
    stdout: (chunk) => {
      stdout += chunk
    },
    stderr: (chunk) => {
      stderr += chunk
    },
    exit: (code) => {
      exitCode = code
    },
    // `narrate: io.stderr` is the SAME sink `stderr` above already captures
    // errors into — narration lands in the exact same buffer, exactly like a
    // real invocation's narration and remediation share one fd.
    layers: (verbose) =>
      testLayers(repo, { env, commands, narrate: (line) => (stderr += line), verbose }),
  }
  return { io, result: () => ({ stdout, stderr, exitCode }) }
}
