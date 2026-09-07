import { createHash } from "node:crypto"
import { readFile as readFileFs, writeFile as writeFileFs } from "node:fs/promises"
import { join } from "node:path"
import type { SteeringAnchor, SteeringEdit } from "../SteeringFormat.js"
import { steeringFormatFor } from "../SteeringFormats.js"
import { liveRunInWorktree } from "./Beat.js"

/**
 * The content hash half of the compare-and-swap: over the file's EXACT bytes
 * (never a normalized/trimmed form), so a whitespace-only change invalidates
 * it — package 03's own acceptance criterion. `sha256` purely for a short,
 * collision-safe fixed-length token; never exposed as a security boundary.
 */
export const contentHashOf = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex")

/** The four distinct typed refusals T8 asks for — never a shared message string, so the phone can render a different sentence for each. */
export type WriteRefusalReason =
  | "stale-token"
  | "not-resting"
  | "file-vanished"
  | "anchor-unresolved"

export interface WriteRefusal {
  readonly ok: false
  readonly reason: WriteRefusalReason
  /** Which half of the compare-and-swap token moved — only set for `stale-token`. */
  readonly moved?: "sha" | "content-hash"
}

export interface WriteSuccess {
  readonly ok: true
}

export type WriteResult = WriteSuccess | WriteRefusal

export interface WriteNoteRequest {
  readonly worktreePath: string
  /** Path to the steering file, relative to `worktreePath`. */
  readonly filePath: string
  /** The token's HEAD-sha half, read by the client off the same render that offered editing. */
  readonly expectedHeadSha: string
  /** The token's content-hash half (`contentHashOf` over the file's exact bytes at render time). */
  readonly expectedContentHash: string
  readonly mode: string
  readonly anchor: SteeringAnchor
}

/**
 * Every side effect `writeNote` needs, injected so tests never touch a real
 * git checkout or filesystem — mirrors `serve/Beat.ts`'s own `BeatDeps`
 * pattern. `actorAt` and `headSha` are both called FRESH on every write
 * (T5: the rest gate is re-checked at write time, never cached), never
 * memoized the way `BeatCache`'s read-side is.
 */
export interface WriteDeps {
  readonly headSha: (worktreePath: string) => Promise<string | undefined>
  /** The actor the worktree currently rests with (`"human"`/`"agent"`/etc, `StateFields.ts`'s `Actor`) — `undefined` when it can't be determined (treated as not-resting-with-a-human, never as an implicit pass). */
  readonly actorAt: (worktreePath: string) => Promise<string | undefined>
  /** `undefined` means the file doesn't exist (or can't be read) — never thrown. */
  readonly readFile: (absPath: string) => Promise<string | undefined>
  readonly writeFile: (absPath: string, content: string) => Promise<void>
}

/** Applies `edits` to `content` as byte-range offset splices — sorted last-to-first so an earlier range's offset is never invalidated by a later edit, mirroring every other splice in this codebase (`ReviewDoc.ts#clearFilePointerTicks` et al.). Positions are 0-based line/character over `\n`-split lines, matching `SteeringEdit`'s own LSP convention. */
export const applySteeringEdits = (content: string, edits: readonly SteeringEdit[]): string => {
  const lines = content.split("\n")
  const toOffset = (pos: { readonly line: number; readonly character: number }): number => {
    let offset = 0
    for (let i = 0; i < pos.line; i += 1) offset += (lines[i]?.length ?? 0) + 1
    return offset + pos.character
  }
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start))
  let result = content
  for (const edit of sorted) {
    result =
      result.slice(0, toOffset(edit.range.start)) +
      edit.newText +
      result.slice(toOffset(edit.range.end))
  }
  return result
}

/** Per-absolute-path write queues — serializes the read-check-apply-write sequence for concurrent writes racing on the SAME file, so exactly one of two racing writes ever applies (the other reads the just-written bytes and correctly refuses as stale). Scoped to this process, which is the whole server. */
const writeQueues = new Map<string, Promise<unknown>>()

const enqueue = <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  // Swallow so one failed write never poisons the queue for the next one.
  writeQueues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

/**
 * The compare-and-swap write T4/T5/T8 ask for: re-reads HEAD's sha, the
 * steering file's exact bytes, and the resting actor — ALL at write time,
 * never trusting what the client rendered from — and writes only when every
 * check passes. A mismatch on any axis rejects OUTRIGHT: no semantic
 * re-apply, no merge, no partial write. Two concurrent calls on the same
 * file are serialized by `enqueue`, so exactly one can ever win the race;
 * the loser re-reads the winner's own write and refuses as stale, correctly.
 */
export const writeNote = (request: WriteNoteRequest, deps: WriteDeps): Promise<WriteResult> => {
  const absPath = join(request.worktreePath, request.filePath)
  return enqueue(absPath, async (): Promise<WriteResult> => {
    const actor = await deps.actorAt(request.worktreePath)
    if (actor !== "human") return { ok: false, reason: "not-resting" }

    const content = await deps.readFile(absPath)
    if (content === undefined) return { ok: false, reason: "file-vanished" }

    const [sha, hash] = [await deps.headSha(request.worktreePath), contentHashOf(content)]
    if (sha !== request.expectedHeadSha) return { ok: false, reason: "stale-token", moved: "sha" }
    if (hash !== request.expectedContentHash) {
      return { ok: false, reason: "stale-token", moved: "content-hash" }
    }

    const format = steeringFormatFor(request.mode)
    if (format === undefined) return { ok: false, reason: "anchor-unresolved" }
    const annotated = format.annotate(content, request.anchor)
    if (!annotated.ok) return { ok: false, reason: "anchor-unresolved" }

    const nextContent = applySteeringEdits(content, annotated.edits)
    await deps.writeFile(absPath, nextContent)
    return { ok: true }
  })
}

/** Live `actorAt`: spawns a fresh `gtd next --json` (never `BeatCache`'s memoized read — T5 requires this axis re-checked at write time) and reads its `actor` field. `undefined` on any spawn failure or unparseable output, which `writeNote` treats as "not resting with a human". */
export const liveActorAt = async (worktreePath: string): Promise<string | undefined> => {
  const outcome = await liveRunInWorktree(worktreePath, "gtd next --json")
  if (outcome.status !== 0) return undefined
  try {
    const parsed = JSON.parse(outcome.stdout) as { readonly actor?: unknown }
    return typeof parsed.actor === "string" ? parsed.actor : undefined
  } catch {
    return undefined
  }
}

/** Live `readFile`/`writeFile`: `undefined` on any read failure (vanished file, permission error, …), never thrown — matches `WriteDeps.readFile`'s contract. */
export const liveReadFile = async (absPath: string): Promise<string | undefined> => {
  try {
    return await readFileFs(absPath, "utf8")
  } catch {
    return undefined
  }
}

export const liveWriteFile = (absPath: string, content: string): Promise<void> =>
  writeFileFs(absPath, content, "utf8")
