import { createHash } from "node:crypto"
import { readFile as readFileFs, mkdir, writeFile as writeFileFs } from "node:fs/promises"
import { dirname } from "node:path"
import type { SteeringAnchor, SteeringEdit } from "../steering/index.js"
import { steeringFormatOrFreeForm } from "../steering/index.js"
import { liveRunInWorktree } from "./Beat.js"
import { resolveWithinRoot } from "./SafePath.js"

/**
 * The content hash half of the compare-and-swap: over the file's EXACT bytes
 * (never a normalized/trimmed form), so a whitespace-only change invalidates
 * it — package 03's own acceptance criterion. `sha256` purely for a short,
 * collision-safe fixed-length token; never exposed as a security boundary.
 */
export const contentHashOf = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex")

/**
 * T8's four named refusals — `stale-token`, `not-resting`, `file-vanished`,
 * `anchor-unresolved` (a stale index, or a paragraph line that no longer
 * parses) — never a shared message string, so the phone can render a
 * different sentence for each. One more, reachable but not among T8's four,
 * gets its OWN distinct value rather than being folded into
 * `anchor-unresolved` (the bug a previous round of this package shipped):
 * `note-collision` (the anchor resolved fine, but `annotate` refused because
 * the derived note id already names an existing definition — `SteeringFormat`
 * `id-collision`, T2's own "two attaches at the same anchor are rejected").
 * An unregistered/absent `request.mode` is no longer a refusal at all — it
 * resolves to the free-form format (`steering/index.ts#steeringFormatOrFreeForm`),
 * which only ever resolves a `paragraph` anchor, so a non-paragraph anchor
 * against it surfaces as `anchor-unresolved` like any other stale anchor.
 */
export type WriteRefusalReason =
  | "stale-token"
  | "not-resting"
  | "file-vanished"
  | "anchor-unresolved"
  | "note-collision"

export interface WriteRefusal {
  readonly ok: false
  readonly reason: WriteRefusalReason
  /** Which half of the compare-and-swap token moved — only set for `stale-token`. */
  readonly moved?: "sha" | "content-hash"
}

/**
 * A `ui.format` command that ran but didn't leave the file formatted the way
 * the client expects — reported so the phone can name what happened, never
 * turned into a refusal or a revert (Task 5's own bullet: formatting failure
 * never invalidates the write itself).
 */
export interface WriteFormatNotice {
  readonly command: string
  /** `null` when the command's binary couldn't even be spawned — mirrors `Beat.ts#SpawnOutcome.status`'s own convention. */
  readonly exitCode: number | null
}

export interface WriteSuccess {
  readonly ok: true
  /** The hash of the bytes actually on disk AFTER `deps.formatCommand` ran (or of `nextContent` itself when no formatter is configured) — the token a client swaps in for its next write, so its own successful write never invalidates its own compare-and-swap token. */
  readonly contentHash: string
  readonly formatNotice?: WriteFormatNotice
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
  readonly mode: string | undefined
  readonly anchor: SteeringAnchor
  /** The human's own typed note body — carried verbatim into the new footnote definition by `SteeringFormat.annotate`, never a placeholder. */
  readonly text: string
}

/**
 * `writeValue`'s own request — mirrors `WriteNoteRequest` field for field
 * except its last: `checked`/`text` are both OPTIONAL (a hunk tick sends only
 * `checked`; a free-text commit sends both together in ONE request), where
 * `WriteNoteRequest.text` is mandatory. Delegates to `SteeringFormat.apply`
 * rather than `annotate`.
 */
export interface WriteValueRequest {
  readonly worktreePath: string
  readonly filePath: string
  readonly expectedHeadSha: string
  readonly expectedContentHash: string
  readonly mode: string | undefined
  readonly anchor: SteeringAnchor
  readonly checked?: boolean
  readonly text?: string
}

/**
 * Every side effect `writeNote` needs, injected so tests never touch a real
 * git checkout or filesystem — mirrors `ui/Beat.ts`'s own `BeatDeps`
 * pattern. `actorAt` and `headSha` are both called FRESH on every write
 * (T5: the rest gate is re-checked at write time, never cached) — there is
 * no caching layer anywhere in this package to lean on instead; `Beat.ts#readStep`
 * itself re-reads the worktree on every call too.
 */
/**
 * `WriteDeps.readFile`/`ReadSteeringFileDeps.readFile`'s own return shape —
 * carries the "nothing is there yet" vs "I could not read what's there"
 * distinction that `liveReadFile` alone can see (it's the only place with the
 * real `errno`), so every call site reads a tag it cannot ignore instead of a
 * bare `string | undefined` that collapses both into the same falsy value.
 * Only `absent` may create-on-write; `unreadable` always refuses.
 */
export type ReadFileResult =
  | { readonly kind: "content"; readonly content: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" }

export interface WriteDeps {
  readonly headSha: (worktreePath: string) => Promise<string | undefined>
  /** The actor the worktree currently rests with (`"human"`/`"agent"`/etc, `StateFields.ts`'s `Actor`) — `undefined` when it can't be determined (treated as not-resting-with-a-human, never as an implicit pass). */
  readonly actorAt: (worktreePath: string) => Promise<string | undefined>
  /** Tagged `absent`/`unreadable`/`content` — see `ReadFileResult`. Never thrown. */
  readonly readFile: (absPath: string) => Promise<ReadFileResult>
  readonly writeFile: (absPath: string, content: string) => Promise<void>
  /**
   * `ui.format`'s own live spawn, `undefined` exactly when that config key is
   * unset (Task 5: "unset means no formatting at all — no command spawned").
   * Its `ok`/`exitCode` are read only to build a `WriteFormatNotice` — never
   * to refuse or revert the write, which has already landed on disk by the
   * time this runs.
   */
  readonly formatCommand?: (absPath: string) => Promise<{
    readonly ok: boolean
    readonly command: string
    readonly exitCode: number | null
  }>
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

/** The one shape both `writeNote` and `writeValue` need off a request before they can dispatch to their own format member (`annotate`/`apply`). */
interface CasRequest {
  readonly worktreePath: string
  readonly expectedHeadSha: string
  readonly expectedContentHash: string
}

/**
 * The actor/sha/content-hash compare-and-swap gate T4/T5/T8 ask for —
 * re-reads HEAD's sha, the steering file's exact bytes, and the resting
 * actor ALL at write time, never trusting what the client rendered from —
 * shared by `writeNote` and `writeValue` so the two checks (and their four
 * distinct refusal shapes) can never drift apart. `ok: true` carries the
 * freshly-read `content` on to the caller's own format dispatch.
 */
const verifyForWrite = async (
  request: CasRequest,
  absPath: string,
  deps: WriteDeps,
): Promise<WriteRefusal | { readonly ok: true; readonly content: string }> => {
  const actor = await deps.actorAt(request.worktreePath)
  if (actor !== "human") return { ok: false, reason: "not-resting" }

  // A resolved path with nothing at it yet (never written) reads as empty and
  // lets the write through — only a `filePath` escaping the worktree (caught
  // by `resolveWithinRoot` before this is ever called), or a path that IS
  // there but couldn't be read, refuses `file-vanished`.
  const read = await deps.readFile(absPath)
  if (read.kind === "unreadable") return { ok: false, reason: "file-vanished" }
  const content = read.kind === "content" ? read.content : ""

  const [sha, hash] = [await deps.headSha(request.worktreePath), contentHashOf(content)]
  if (sha !== request.expectedHeadSha) return { ok: false, reason: "stale-token", moved: "sha" }
  if (hash !== request.expectedContentHash) {
    return { ok: false, reason: "stale-token", moved: "content-hash" }
  }
  return { ok: true, content }
}

/**
 * Runs `deps.formatCommand` (when configured) after the bytes are already on
 * disk, then re-reads the file so the returned `contentHash` reflects what
 * formatting actually produced — never `nextContent` itself once a formatter
 * ran, since that's the PRE-format text. A formatter failure (non-zero exit,
 * missing binary) becomes a `formatNotice`, never a refusal: the write above
 * this call already succeeded and stays on disk either way. Falls back to
 * `nextContent` only if the re-read itself comes back empty-handed, which
 * should not happen for a file this function just wrote.
 */
const finishWrite = async (
  absPath: string,
  nextContent: string,
  deps: WriteDeps,
): Promise<WriteSuccess> => {
  if (deps.formatCommand === undefined) {
    return { ok: true, contentHash: contentHashOf(nextContent) }
  }
  // Belt-and-suspenders alongside `Server.ts#buildFormatCommand`'s own
  // internal catch: whatever `deps.formatCommand` implementation a caller
  // wires in (a test double included), a throw here must still resolve as a
  // `formatNotice`, never reject the mutation after the bytes already
  // landed on disk above this call.
  const outcome = await deps.formatCommand(absPath).catch((error: unknown) => ({
    ok: false as const,
    command: "<format command threw before naming itself>",
    exitCode: null,
    cause: error,
  }))
  const reread = await deps.readFile(absPath)
  const formatted = reread.kind === "content" ? reread.content : nextContent
  return {
    ok: true,
    contentHash: contentHashOf(formatted),
    ...(outcome.ok
      ? {}
      : { formatNotice: { command: outcome.command, exitCode: outcome.exitCode } }),
  }
}

/** `annotate`/`apply`'s shared refusal mapping: `id-collision` → `note-collision`, anything else → `anchor-unresolved` — the one place `writeNote`/`writeValue` translate a `SteeringAnnotateResult` refusal into a `WriteRefusalReason`. */
const annotateRefusal = (reason: "anchor-not-found" | "id-collision"): WriteRefusal => ({
  ok: false,
  reason: reason === "id-collision" ? "note-collision" : "anchor-unresolved",
})

/**
 * The compare-and-swap write T4/T5/T8 ask for (`verifyForWrite`), splicing
 * through `SteeringFormat.annotate`. A mismatch on any axis rejects OUTRIGHT:
 * no semantic re-apply, no merge, no partial write. Two concurrent calls on
 * the same file are serialized by `enqueue`, so exactly one can ever win the
 * race; the loser re-reads the winner's own write and refuses as stale,
 * correctly.
 */
export const writeNote = (request: WriteNoteRequest, deps: WriteDeps): Promise<WriteResult> => {
  // `filePath` is still a client string even with `worktreePath` off every
  // procedure input — `../../../etc/passwd` must refuse here, before ever
  // reaching `readFile`/`writeFile`, exactly as an already-vanished file
  // would (there is nothing at that path INSIDE the served worktree either
  // way, from this compare-and-swap's point of view).
  const absPath = resolveWithinRoot(request.worktreePath, request.filePath)
  if (absPath === undefined) return Promise.resolve({ ok: false, reason: "file-vanished" })
  return enqueue(absPath, async (): Promise<WriteResult> => {
    const verified = await verifyForWrite(request, absPath, deps)
    if (!verified.ok) return verified

    const format = steeringFormatOrFreeForm(request.mode)
    const annotated = format.annotate(verified.content, request.anchor, request.text)
    if (!annotated.ok) return annotateRefusal(annotated.reason)

    const nextContent = applySteeringEdits(verified.content, annotated.edits)
    await deps.writeFile(absPath, nextContent)
    return finishWrite(absPath, nextContent, deps)
  })
}

/**
 * The compare-and-swap write for a CHECKBOX value (package 03): the same
 * `verifyForWrite` gate `writeNote` runs, splicing through
 * `SteeringFormat.apply` instead of `annotate` — a question answer's radio
 * pick, or a review hunk/chunk tick. `WriteRefusalReason` gains no new
 * values: `apply`'s own `anchor-not-found`/`id-collision` map onto
 * `anchor-unresolved`/`note-collision` exactly as `annotate`'s do in
 * `writeNote`, even though `apply` never actually produces the latter.
 */
export const writeValue = (request: WriteValueRequest, deps: WriteDeps): Promise<WriteResult> => {
  const absPath = resolveWithinRoot(request.worktreePath, request.filePath)
  if (absPath === undefined) return Promise.resolve({ ok: false, reason: "file-vanished" })
  return enqueue(absPath, async (): Promise<WriteResult> => {
    const verified = await verifyForWrite(request, absPath, deps)
    if (!verified.ok) return verified

    const format = steeringFormatOrFreeForm(request.mode)
    const applied = format.apply(verified.content, request.anchor, {
      ...(request.checked !== undefined ? { checked: request.checked } : {}),
      ...(request.text !== undefined ? { text: request.text } : {}),
    })
    if (!applied.ok) return annotateRefusal(applied.reason)

    const nextContent = applySteeringEdits(verified.content, applied.edits)
    await deps.writeFile(absPath, nextContent)
    return finishWrite(absPath, nextContent, deps)
  })
}

/** Live `actorAt`: spawns a fresh `gtd next --json` (T5 requires this axis re-checked at write time, never a cached read) and reads its `actor` field. `undefined` on any spawn failure or unparseable output, which `writeNote` treats as "not resting with a human". */
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

/**
 * Live `readFile`: the only place that sees the real `errno`, so the only
 * place that classifies. `ENOENT`/`ENOTDIR` (nothing there yet) is `absent`;
 * every other failure — `EACCES`, `EISDIR`, `EPERM`, `EIO`, `EMFILE`,
 * anything unrecognised, or a non-`Error` throw — is `unreadable`. Fails
 * closed: an unrecognised failure never becomes `absent`, because `absent` is
 * the branch that authorises a truncating create-on-write. Never throws.
 */
export const liveReadFile = async (absPath: string): Promise<ReadFileResult> => {
  try {
    const content = await readFileFs(absPath, "utf8")
    return { kind: "content", content }
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
    if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" }
    return { kind: "unreadable" }
  }
}

/**
 * `mkdir -p` the containing directory first — Task 4's "a missing served
 * file reads as empty" means the FIRST write to a mode-less file can target a
 * `.gtd/` that doesn't exist yet in this worktree at all (`Install.ts#`'s own
 * `mkdir -p "$(dirname "$f")"` covers the same class of file for the CLI's
 * own writes); a plain `writeFile` would throw `ENOENT` instead of creating
 * it, which `enqueue`'s task lets escape as an unhandled rejection — a
 * generic 500 the client can only render as the "unknown" refusal sentence.
 */
export const liveWriteFile = async (absPath: string, content: string): Promise<void> => {
  await mkdir(dirname(absPath), { recursive: true })
  await writeFileFs(absPath, content, "utf8")
}
