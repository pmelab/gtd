import { join } from "node:path"
import type { SteeringView } from "../SteeringFormat.js"
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
  | { readonly ok: false; readonly reason: "file-vanished" | "unsupported-mode" }

export interface ReadSteeringFileRequest {
  readonly worktreePath: string
  /** Path to the steering file, relative to `worktreePath` — same convention as `Write.ts#WriteNoteRequest.filePath`. */
  readonly filePath: string
  readonly mode: string
}

/** Injected side effects, mirroring `Write.ts#WriteDeps`'s split — `headSha` absent (not `undefined`'s own string) is a real possibility (a fresh worktree with no commits yet), so it's carried through as `""` rather than failing the whole read over it: a token mismatch on write is a normal, already-handled `stale-token` refusal either way. */
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
  const absPath = join(request.worktreePath, request.filePath)
  const content = await deps.readFile(absPath)
  if (content === undefined) return { ok: false, reason: "file-vanished" }

  const viewResult = steeringViewFor(request.mode, content)
  if (!viewResult.ok) return { ok: false, reason: "unsupported-mode" }

  const headSha = (await deps.headSha(request.worktreePath)) ?? ""
  return { ok: true, content, headSha, contentHash: contentHashOf(content), view: viewResult.view }
}
