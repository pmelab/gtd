/**
 * A circuit breaker for the EFFECTOR, not a machine feature. A stall — a
 * dispatched `prompt` beat whose agent turn changed nothing — is invisible to
 * the pure machine (a no-change turn produces neither a commit nor a pending
 * diff) and `retry:` cannot see it either (retry counts commits). The
 * machine-level answer, where it applies, is a `C` edge: a state that may
 * legitimately finish with nothing to change should declare one, and it can
 * never trip this detector. This module is the driver-facing fallback for
 * every OTHER state — noticing that a prompt beat repeated verbatim (same
 * state, same rendered content, same HEAD) and stopping instead of
 * re-dispatching forever.
 *
 * Owned exclusively by `gtd next --json --dispatch` (see `program.ts`'s
 * `runNextCommand`) — plain `gtd next --json` is documented mutation-free and
 * is both POLLED and PEEKED, so arming/consuming the marker there would eat a
 * stall report or report one before the first real dispatch. `--dispatch` is
 * the only claim that can be checked: "I am handing this beat to an
 * executor."
 *
 * The marker is one line of JSON at `<per-worktree git dir>/gtd-beat`
 * (`Git.ts`'s `gitDir`, never `Cwd.root + "/.git"` — a linked worktree's
 * `.git` is a FILE, and per-worktree isolation is the point). Reporting a
 * stall CONSUMES the marker (the file is deleted): each launch gets exactly
 * one fresh dispatch, and a beat fixed out of band (a wrong model, a missing
 * API key — identical state/content/HEAD) can be dispatched again rather than
 * wedging forever.
 *
 * Best-effort, never fatal: an absent, unreadable, or unparseable marker
 * reads as "no record"; any read/write/delete failure degrades to
 * `stalled: false` and `gtd next` still succeeds. A read-only git dir must
 * not break the loop, and there is no stderr channel in a command handler to
 * warn on — this silent degradation is the documented tradeoff.
 */

import { createHash } from "node:crypto"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { GitService } from "./Git.js"

const MARKER_FILE = "gtd-beat"

/** One dispatched `prompt` beat: the resting state, its rendered content, and HEAD at dispatch time (`""` for an unborn HEAD — `rest.context.currentCommit`'s own convention). */
export interface Beat {
  readonly state: string
  readonly content: string
  readonly head: string
}

/** The marker file's decoded shape — identical fields to `Beat`, named separately since a corrupt/legacy file decodes to `undefined`, never a partial `Beat`. */
export interface BeatRecord {
  readonly state: string
  readonly content: string
  readonly head: string
}

/** SHA-256 hex digest of `content` — the marker never stores a prompt's full text, only its fingerprint. */
export const hashContent = (content: string): string =>
  createHash("sha256").update(content).digest("hex")

/** True when `record` names the exact same beat as `beat` — state, content hash, and HEAD all equal. */
export const isSameBeat = (record: BeatRecord, beat: Beat): boolean =>
  record.state === beat.state && record.content === beat.content && record.head === beat.head

const decodeRecord = (raw: string): BeatRecord | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof BeatRecord, unknown>>
    const { state, content, head } = parsed
    if (typeof state === "string" && typeof content === "string" && typeof head === "string") {
      return { state, content, head }
    }
    return undefined
  } catch {
    return undefined
  }
}

const readRecord = (
  fs: FileSystem.FileSystem,
  path: string,
): Effect.Effect<BeatRecord | undefined> =>
  fs.readFileString(path).pipe(
    Effect.map(decodeRecord),
    Effect.catchAll(() => Effect.succeed(undefined)),
  )

/**
 * Read the marker (tolerating absent/corrupt), compare it to `beat`, then
 * consume-or-arm: an equal record reports `stalled: true` and DELETES the
 * marker; anything else reports `false` and WRITES `beat` as the new marker.
 * Every git/filesystem failure along the way degrades to `false` rather than
 * propagating — see the module doc comment's best-effort contract.
 */
export const resolveDispatch = (
  beat: Beat,
): Effect.Effect<boolean, never, GitService | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    const dir = yield* git.gitDir().pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    if (dir === undefined) return false
    const path = join(dir, MARKER_FILE)

    const record = yield* readRecord(fs, path)
    if (record !== undefined && isSameBeat(record, beat)) {
      yield* fs.remove(path).pipe(Effect.catchAll(() => Effect.void))
      return true
    }

    yield* fs
      .writeFileString(
        path,
        JSON.stringify({ state: beat.state, content: beat.content, head: beat.head }),
      )
      .pipe(Effect.catchAll(() => Effect.void))
    return false
  })
