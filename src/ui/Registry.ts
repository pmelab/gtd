import type { LoopChild, LoopOutcome } from "./Loop.js"

/** The one named refusal: a second done action on a worktree with a live child. */
export type DriveRefusalReason = "already-driving"

/**
 * How stale a foreign driver's log write may be before it no longer reads as
 * "possibly driven elsewhere" — a single named constant, not repeated at
 * each call site.
 */
export const FOREIGN_DRIVER_FRESHNESS_MS = 30_000

/**
 * A loop child's failure, captured verbatim for the fleet row to show —
 * requirement 6's "failures show the captured output and the exit code
 * inline, since gtd exits 1 for every refusal and the text is the only thing
 * that distinguishes them." Never derived from a signal death (a deliberate
 * `stop` always ends in one — see `Loop.ts#stopChild`'s own doc comment —
 * and that is not a failure), only from a non-zero exit or a spawn that
 * never happened at all.
 */
export interface LoopFailure {
  readonly stdout: string
  readonly stderr: string
  readonly status: number | null
  readonly spawnError?: string
}

/** True for an outcome requirement 6's own sentence means to surface — never a signal death (that's `stop`'s own doing, not a failure). */
const isFailure = (outcome: LoopOutcome): boolean =>
  outcome.spawnError !== undefined || (outcome.status !== null && outcome.status !== 0)

/**
 * One registry slot: `placeholder` is true only for the gap `reserve` opens
 * between the double-drive check and the real child existing (shim creation
 * is async). `isDriving` counts a placeholder as driving (it closes the
 * double-drive race); `get` does NOT expose one — a stop arriving in that
 * gap must be a genuine no-op (nothing to signal yet), never a hang against
 * a `wait` that never resolves.
 */
interface Slot {
  readonly child: LoopChild
  readonly placeholder: boolean
}

/**
 * The in-memory registry of the server's own child processes: worktree id ->
 * live child handle. Nothing here is ever persisted (a restart loses the
 * whole map, which is the point: each worktree reports its real rest on the
 * next read, nothing auto-resumes).
 */
export class Registry {
  private readonly live = new Map<string, Slot>()
  private readonly lastFailure = new Map<string, LoopFailure>()

  /** True while a worktree has a live child OR a `reserve`d placeholder — the done action's own double-drive check, and a registry entry "always wins" over the foreign-driver log signal. */
  isDriving(worktreeId: string): boolean {
    return this.live.has(worktreeId)
  }

  /**
   * Registers `child` under `worktreeId`, clears any PRIOR drive's recorded
   * failure (a fresh drive starting deserves a clean slate, not yesterday's
   * stale error), and arranges its own removal once the child exits — on ANY
   * exit, a clean one or a signal death alike, since `LoopChild.wait`
   * resolves either way. A non-zero exit or a spawn that never happened is
   * recorded via `lastLoopFailure` before removal, so the fleet row can
   * still show it after Working clears. Never queues: caller must check
   * `isDriving` first and refuse rather than call this on a worktree already
   * registered.
   */
  register(worktreeId: string, child: LoopChild): void {
    this.lastFailure.delete(worktreeId)
    const slot: Slot = { child, placeholder: false }
    this.live.set(worktreeId, slot)
    void child.wait
      .then((outcome) => {
        if (isFailure(outcome)) {
          this.lastFailure.set(worktreeId, {
            stdout: outcome.stdout,
            stderr: outcome.stderr,
            status: outcome.status,
            ...(outcome.spawnError !== undefined ? { spawnError: outcome.spawnError } : {}),
          })
        }
      })
      .finally(() => {
        // Only remove if THIS slot is still the registered one — guards a
        // pathological re-register racing the old child's own exit.
        if (this.live.get(worktreeId) === slot) this.live.delete(worktreeId)
      })
  }

  /**
   * Atomically reserves `worktreeId` with a placeholder — `false`, no-op, if
   * already driving. Closes the race between the done action's `isDriving`
   * check and its eventual `register`/`replace` call across the `await` a
   * real spawn needs (shim creation): a second `done` arriving in that
   * window sees `isDriving` true immediately, synchronously, with no
   * `await` in between to lose the race on. The caller MUST eventually call
   * either `replace` (spawn succeeded) or `release` (spawn failed) — leaving
   * a reservation unresolved pins that worktree to Working forever.
   */
  reserve(worktreeId: string): boolean {
    if (this.live.has(worktreeId)) return false
    this.lastFailure.delete(worktreeId)
    this.live.set(worktreeId, {
      child: { wait: new Promise(() => {}), interrupt: () => {}, kill: () => {} },
      placeholder: true,
    })
    return true
  }

  /**
   * Releases a placeholder `reserve` installed with no real child ever
   * having existed — the done action's own failure path (shim creation
   * rejected, spawn threw) between `reserve` and `replace`. A no-op if the
   * slot is no longer a placeholder (already `replace`d) or already gone,
   * so a stray call can never undo a real registration.
   */
  release(worktreeId: string): void {
    const slot = this.live.get(worktreeId)
    if (slot !== undefined && slot.placeholder) this.live.delete(worktreeId)
  }

  /** Swaps the placeholder `reserve` installed for the real child, wiring its own removal on exit exactly as `register` does. */
  replace(worktreeId: string, child: LoopChild): void {
    this.register(worktreeId, child)
  }

  /**
   * The live, signalable child for `worktreeId` — `undefined` both when
   * nothing is registered AND when the only entry is still a `reserve`
   * placeholder (nothing real to signal yet). Stop is a no-op on either.
   */
  get(worktreeId: string): LoopChild | undefined {
    const slot = this.live.get(worktreeId)
    return slot !== undefined && !slot.placeholder ? slot.child : undefined
  }

  /** The most recent loop failure recorded for `worktreeId`, or `undefined` if its last (or current) drive never failed, or no drive has happened yet. Survives after `isDriving` goes back to `false` — the row stops reading Working but keeps showing what broke, until the next `register`/`reserve` clears it. */
  lastLoopFailure(worktreeId: string): LoopFailure | undefined {
    return this.lastFailure.get(worktreeId)
  }

  /** Kills every live child (a placeholder's `kill` is a harmless no-op) and forgets them all, persisting nothing — a restart's own contract. */
  killAll(): void {
    for (const slot of this.live.values()) slot.child.kill()
    this.live.clear()
  }

  /**
   * The foreign-driver signal: imprecise by nature, so it must say so where
   * it's surfaced (the UI layer's job, not this method's). A registry entry
   * always wins — this worktree's own server-spawned child (or a pending
   * reservation for one) is never "foreign". Otherwise the only available
   * signal is the log's own mtime: recent enough reads as possibly driven
   * elsewhere; stale, or no log at all, never does.
   */
  possiblyForeignDriven(worktreeId: string, logMtime: number | undefined, now: number): boolean {
    if (this.isDriving(worktreeId)) return false
    if (logMtime === undefined) return false
    return now - logMtime < FOREIGN_DRIVER_FRESHNESS_MS
  }
}
