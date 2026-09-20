import type { SteeringView } from "../steering/index.js"
import { resolveWithinRoot } from "./SafePath.js"
import { steeringViewFor } from "./View.js"
import { contentHashOf } from "./Write.js"

/**
 * What a screen needs before it can render AND, later, write back through
 * `writeNote`'s own compare-and-swap: the file's exact bytes, its `view`
 * (`View.ts#steeringViewFor`), and the two tokens (`headSha`/`contentHash`)
 * `writeNote` already demands unchanged from render time. Closes the gap the
 * package 04 spec review flagged — `Review`/`Plan` took a bare `content`
 * prop with no way to have actually fetched it (there was no procedure that
 * read a steering file's live bytes at all), and no way to call `writeNote`
 * afterward without a token it never had.
 */
export type ReadSteeringFileResult =
  | {
      readonly ok: true
      readonly content: string
      readonly headSha: string
      readonly contentHash: string
      readonly view: SteeringView
    }
  | {
      readonly ok: false
      readonly reason: "file-vanished" | "head-unresolved"
    }

export interface ReadSteeringFileRequest {
  readonly worktreePath: string
  /** Path to the steering file, relative to `worktreePath` — same convention as `Write.ts#WriteNoteRequest.filePath`. */
  readonly filePath: string
  readonly mode: string | undefined
}

/** Injected side effects, mirroring `Write.ts#WriteDeps`'s split. */
export interface ReadSteeringFileDeps {
  readonly headSha: (worktreePath: string) => Promise<string | undefined>
  readonly readFile: (absPath: string) => Promise<string | undefined>
}

/**
 * Reads a steering file's live bytes plus its `view`, `headSha` and
 * `contentHash` in one round trip — the read-side counterpart to
 * `Write.ts#writeNote`'s write-side compare-and-swap, sharing its exact
 * token scheme so a screen that reads through here can write back through
 * there without a second fetch.
 */
export const readSteeringFile = async (
  request: ReadSteeringFileRequest,
  deps: ReadSteeringFileDeps,
): Promise<ReadSteeringFileResult> => {
  // Same client-string boundary `Write.ts#writeNote` refuses at — a
  // `filePath` that escapes the served worktree reads as vanished, never
  // reaching `readFile` with a path outside `worktreePath` at all.
  const absPath = resolveWithinRoot(request.worktreePath, request.filePath)
  if (absPath === undefined) return { ok: false, reason: "file-vanished" }
  // A resolved path with nothing at it yet (a mode-less steering file gtd
  // hasn't written) reads as an empty document, not a refusal — only an
  // escaping `filePath` (caught above) still refuses `file-vanished`.
  const content = (await deps.readFile(absPath)) ?? ""

  const view = steeringViewFor(request.mode, content)

  const headSha = await deps.headSha(request.worktreePath)
  if (headSha === undefined) return { ok: false, reason: "head-unresolved" }
  return { ok: true, content, headSha, contentHash: contentHashOf(content), view }
}
