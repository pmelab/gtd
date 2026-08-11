/**
 * The `@inmem` tier's `CliIo` — routes `gtd`'s whole CLI shell (`runCli`)
 * through the in-memory layers instead of a real repo/process. Captures
 * stdout/stderr/exit into plain values `world.ts` reads back into
 * `lastResult`, exactly mirroring what a real `gtd` invocation's
 * stdout/stderr/exit code would look like.
 */
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
    layers: () => testLayers(repo, { env, commands }),
  }
  return { io, result: () => ({ stdout, stderr, exitCode }) }
}
