import { Effect } from "effect"
import { runCli } from "../cli/index.js"
import type { PinMark } from "../wire/index.js"
import { makeCapturingCliIo } from "./cliIo.js"
import { applyEmittedScript } from "./EmittedScriptRecognizer.js"
import type { InMemRepo } from "./InMemRepo.js"

const gtd = async (repo: InMemRepo, ...args: string[]) => {
  const { io, result } = makeCapturingCliIo(repo)
  await Effect.runPromise(runCli(["node", "gtd.js", ...args], io))
  return result()
}

const apply = (repo: InMemRepo, script: string): void => {
  const outcome = applyEmittedScript(repo, new Map(), script)
  if (!outcome.ok) throw new Error(outcome.error)
}

/**
 * Takes the pending pin or unpin beat — `mark` alone when given — the way a
 * driver does: its script, then its landing. Whether it took one.
 */
export const takePinBeat = async (repo: InMemRepo, mark?: PinMark): Promise<boolean> => {
  const next = await gtd(repo, "next", "--json")
  if (next.exitCode !== 0) return false
  const beat = JSON.parse(next.stdout) as { readonly pin?: PinMark; readonly content: string }
  if (beat.pin === undefined || (mark !== undefined && beat.pin !== mark)) return false
  apply(repo, beat.content)
  const land = await gtd(repo, "land", "--json")
  if (land.exitCode !== 0) throw new Error(`gtd land exited ${land.exitCode}: ${land.stderr}`)
  apply(repo, (JSON.parse(land.stdout) as { readonly script: string }).script)
  return true
}
