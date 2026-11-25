import type { SteeringView, SteeringViewNode } from "../steering/index.js"
import { resolveWithinRoot } from "./SafePath.js"
import { steeringViewFor } from "./View.js"
import type { ReadFileResult } from "./Ports.js"
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
}

/** Injected side effects, mirroring `Write.ts#WriteDeps`'s split. */
export interface ReadSteeringFileDeps {
  readonly headSha: (worktreePath: string) => Promise<string | undefined>
  readonly readFile: (absPath: string) => Promise<ReadFileResult>
  /** The file's content at its last landing; `undefined` when it never landed. */
  readonly lastLanding?: (worktreePath: string, filePath: string) => Promise<string | undefined>
}

/** A node's content without positions or notes, whitespace collapsed: only a real change differs. */
const fingerprint = (node: SteeringViewNode): string =>
  JSON.stringify(node, (key, value: unknown) =>
    key === "anchor" || key === "line" || key === "endLine" || key === "note" || key === "noteCount"
      ? undefined
      : typeof value === "string"
        ? value.replace(/\s+/g, " ").trim()
        : value,
  )

/** Marks each top-level node whose content is absent from the last landing's view. */
const markChanged = (view: SteeringView, landed: string): SteeringView => {
  const before = new Set(steeringViewFor(landed).nodes.map(fingerprint))
  return {
    ...view,
    nodes: view.nodes.map((node) =>
      before.has(fingerprint(node)) ? node : { ...node, changed: true },
    ),
  }
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
  // A resolved path with nothing at it yet (a steering file nobody has
  // written) reads as an empty document, not a refusal — only an
  // escaping `filePath` (caught above) or a path that's there but couldn't be
  // read still refuses `file-vanished`, reusing the existing refusal value.
  const read = await deps.readFile(absPath)
  if (read.kind === "unreadable") return { ok: false, reason: "file-vanished" }
  const content = read.kind === "content" ? read.content : ""

  const plain = steeringViewFor(content)
  const landed = await deps.lastLanding?.(request.worktreePath, request.filePath)
  const view = landed === undefined ? plain : markChanged(plain, landed)

  const headSha = await deps.headSha(request.worktreePath)
  if (headSha === undefined) return { ok: false, reason: "head-unresolved" }
  return { ok: true, content, headSha, contentHash: contentHashOf(content), view }
}
