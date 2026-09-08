import type { LoopChild } from "./Loop.js"

/** T3's one named refusal: a second done action on a worktree with a live child. */
export type DriveRefusalReason = "already-driving"

/**
 * How stale a foreign driver's log write may be before it no longer reads as
 * "possibly driven elsewhere" — a single named constant (T4), not repeated
 * at each call site.
 */
export const FOREIGN_DRIVER_FRESHNESS_MS = 30_000

/**
 * The in-memory registry of the server's own child processes: worktree id ->
 * live child handle. Nothing here is ever persisted (T6) — a server restart
 * loses the whole map, which is the point: each worktree reports its real
 * rest on the next read, nothing auto-resumes.
 */
export class Registry {
  private readonly live = new Map<string, LoopChild>()

  /** True while a live child is registered for `worktreeId` — the done action's own double-drive check (T3), and a registry entry "always wins" over the foreign-driver log signal (T4). */
  isDriving(worktreeId: string): boolean {
    return this.live.has(worktreeId)
  }

  /**
   * Registers `child` under `worktreeId` and arranges its own removal once
   * the child exits — on ANY exit, a clean one or a signal death alike,
   * since `LoopChild.wait` resolves either way. Never queues: caller must
   * check `isDriving` first and refuse rather than call this on a worktree
   * already registered.
   */
  register(worktreeId: string, child: LoopChild): void {
    this.live.set(worktreeId, child)
    void child.wait.finally(() => {
      // Only remove if THIS child is still the registered one — guards a
      // pathological re-register racing the old child's own exit.
      if (this.live.get(worktreeId) === child) this.live.delete(worktreeId)
    })
  }

  /**
   * Atomically reserves `worktreeId` with a placeholder (no-op
   * `interrupt`/`kill`, a `wait` that never resolves on its own) — `false`,
   * no-op, if already driving. Closes the race between the done action's
   * `isDriving` check and its eventual `register`/`replace` call across the
   * `await` a real spawn needs (shim creation): a second `done` arriving in
   * that window sees `isDriving` true immediately, synchronously, with no
   * `await` in between to lose the race on. A stop arriving in that same
   * narrow window is a no-op against the placeholder — the caller can retry;
   * the row already reads as Working either way.
   */
  reserve(worktreeId: string): boolean {
    if (this.live.has(worktreeId)) return false
    this.live.set(worktreeId, {
      wait: new Promise(() => {}),
      interrupt: () => {},
      kill: () => {},
    })
    return true
  }

  /** Swaps the placeholder `reserve` installed for the real child, wiring its own removal on exit exactly as `register` does. */
  replace(worktreeId: string, child: LoopChild): void {
    this.register(worktreeId, child)
  }

  /** The live child for `worktreeId`, or `undefined` if none — stop is a no-op on the latter (T5). */
  get(worktreeId: string): LoopChild | undefined {
    return this.live.get(worktreeId)
  }

  /** T6's restart: kills every live child and forgets them all, persisting nothing. */
  killAll(): void {
    for (const child of this.live.values()) child.kill()
    this.live.clear()
  }

  /**
   * T4's foreign-driver signal: imprecise by nature, so it must say so where
   * it's surfaced (the UI layer's job, not this method's). A registry entry
   * always wins — this worktree's own server-spawned child is never
   * "foreign". Otherwise the only available signal is the log's own mtime:
   * recent enough reads as possibly driven elsewhere; stale, or no log at
   * all, never does.
   */
  possiblyForeignDriven(worktreeId: string, logMtime: number | undefined, now: number): boolean {
    if (this.isDriving(worktreeId)) return false
    if (logMtime === undefined) return false
    return now - logMtime < FOREIGN_DRIVER_FRESHNESS_MS
  }
}
