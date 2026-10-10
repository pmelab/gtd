import { createHash } from "node:crypto"
import { readFile as readFileFs, mkdir, writeFile as writeFileFs } from "node:fs/promises"
import { dirname } from "node:path"
import type { SteeringAnchor } from "../steering/index.js"
import { applySteeringEdits, steeringFormatOrFreeForm } from "../steering/index.js"
import { liveRunInWorktree } from "./Beat.js"
import { resolveWithinRoot } from "./SafePath.js"

/**
 * The content-hash half of the compare-and-swap, over the file's EXACT bytes —
 * never a normalized form, so a whitespace-only change invalidates it. `sha256`
 * purely for a short collision-safe token; never a security boundary.
 */
export const contentHashOf = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex")

/**
 * One distinct value per refusal, never a shared message string, so the phone
 * can render a different sentence for each. `note-collision` stays separate
 * from `anchor-unresolved`: the anchor resolved fine, the derived note id
 * collided. An absent or unregistered `mode` is never a refusal — it resolves
 * to the free-form format, which only ever resolves a `paragraph` anchor.
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

/** A `ui.format` command that ran but failed — reported so the phone can name it, never turned into a refusal or a revert. */
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
 * Carries the "nothing there yet" vs "could not read what's there" distinction
 * that only `liveReadFile` can see, so no call site can collapse both into one
 * falsy value. Only `absent` may create-on-write; `unreadable` always refuses.
 */
export type ReadFileResult =
  | { readonly kind: "content"; readonly content: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" }

/** Every side effect a write needs, injected so tests touch no real checkout. `actorAt`/`headSha` are called FRESH on every write — the rest gate is re-checked at write time, never cached. */
export interface WriteDeps {
  readonly headSha: (worktreePath: string) => Promise<string | undefined>
  /** The actor the worktree currently rests with (`"human"`/`"agent"`/etc, `StateFields.ts`'s `Actor`) — `undefined` when it can't be determined (treated as not-resting-with-a-human, never as an implicit pass). */
  readonly actorAt: (worktreePath: string) => Promise<string | undefined>
  /** Tagged `absent`/`unreadable`/`content` — see `ReadFileResult`. Never thrown. */
  readonly readFile: (absPath: string) => Promise<ReadFileResult>
  readonly writeFile: (absPath: string, content: string) => Promise<void>
  /** `ui.format`'s live spawn, `undefined` exactly when that key is unset. Read only to build a `WriteFormatNotice` — the write has already landed on disk by the time this runs. */
  readonly formatCommand?: (absPath: string) => Promise<{
    readonly ok: boolean
    readonly command: string
    readonly exitCode: number | null
  }>
}

/** Per-path write queues: serializes read-check-apply-write so exactly one of two racing writes applies — the loser re-reads the winner's bytes and correctly refuses as stale. */
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
 * The compare-and-swap gate: re-reads HEAD's sha, the file's exact bytes and
 * the resting actor at write time, never trusting what the client rendered
 * from. Shared by both writers so their refusal shapes cannot drift apart.
 */
const verifyForWrite = async (
  request: CasRequest,
  absPath: string,
  deps: WriteDeps,
): Promise<WriteRefusal | { readonly ok: true; readonly content: string }> => {
  const actor = await deps.actorAt(request.worktreePath)
  if (actor !== "human") return { ok: false, reason: "not-resting" }

  // Nothing there yet reads as empty and lets the write through; only a path
  // that IS there but unreadable refuses (an escaping `filePath` was already
  // caught by `resolveWithinRoot`).
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
 * Runs `deps.formatCommand` after the bytes are on disk, then re-reads so the
 * returned `contentHash` is the POST-format text. A formatter failure becomes
 * a `formatNotice`, never a refusal — the write already succeeded.
 */
const finishWrite = async (
  absPath: string,
  nextContent: string,
  deps: WriteDeps,
): Promise<WriteSuccess> => {
  if (deps.formatCommand === undefined) {
    return { ok: true, contentHash: contentHashOf(nextContent) }
  }
  // Whatever implementation a caller wires in, a throw here must still resolve
  // as a `formatNotice` — the bytes already landed on disk above.
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

/** The one place a `SteeringAnnotateResult` refusal becomes a `WriteRefusalReason`. */
const annotateRefusal = (reason: "anchor-not-found" | "id-collision"): WriteRefusal => ({
  ok: false,
  reason: reason === "id-collision" ? "note-collision" : "anchor-unresolved",
})

/** A compare-and-swap write through `SteeringFormat.annotate`. A mismatch on any axis rejects OUTRIGHT: no semantic re-apply, no merge, no partial write. */
export const writeNote = (request: WriteNoteRequest, deps: WriteDeps): Promise<WriteResult> => {
  // `filePath` is a client string: an escaping path must refuse here, before
  // `readFile`/`writeFile`, and reads as vanished — there is nothing at that
  // path inside the served worktree either way.
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

/** `writeNote`'s twin for a CHECKBOX value — a question's radio pick, or a review hunk/chunk tick — through `SteeringFormat.apply`. Same gate, same refusals. */
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

/** Live `actorAt`: spawns a fresh `gtd next --json` and reads its `actor`. `undefined` on any failure, which the gate treats as "not resting with a human". */
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
 * The only place that sees the real `errno`, so the only place that
 * classifies. `ENOENT`/`ENOTDIR` is `absent`; everything else is `unreadable`.
 * Fails closed — `absent` is the branch that authorises a truncating
 * create-on-write. Never throws.
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
