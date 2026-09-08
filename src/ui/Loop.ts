import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { Effect } from "effect"
import { worktreeId } from "./Discover.js"
import type { DriveRefusalReason, Registry } from "./Registry.js"

/** One loop child's outcome — `stdout`/`stderr` arrive as two separate strings, NEVER combined (unlike `CommandRunner`'s `CommandOutcome.output`), because the done action never parses either for state and only cares that the child exited. `signal` is set (and `status` `null`) on a signal death, matching `spawnSync`'s own contract. `spawnError` mirrors `Beat.ts`'s `SpawnOutcome.spawnError`: set (never `status`/`signal`) when the process could never start at all (no `bash` on `$PATH`, a vanished `cwd`) — Node reports that as an `error` event, not an `exit`, so without this `wait` would otherwise hang forever and an unhandled `error` on the `ChildProcess` emitter would crash the whole `gtd ui` process. */
export interface LoopOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly status: number | null
  readonly signal: NodeJS.Signals | null
  readonly spawnError?: string
}

/** A live loop child: `interrupt`/`kill` send real OS signals to the actual process's whole GROUP, not just its own pid (see `signalGroup`'s own doc comment for why) — never merely cancelling an Effect fiber. `wait` resolves once the child (the group's own leader) has exited, on any exit, clean or signalled. */
export interface LoopChild {
  readonly wait: Promise<LoopOutcome>
  readonly interrupt: () => void
  readonly kill: () => void
}

export interface LoopSpawnRequest {
  /** The configured loop command — any language, run as `bash -c command`. */
  readonly command: string
  /** The worktree — the child's cwd, never the server's own. */
  readonly cwd: string
  /** A shim directory (see `Shim.ts`) PREPENDED to `$PATH`, so it wins over any earlier entry — the config decisions live in `Loop.ts`'s own doc comment, not repeated at each call site. */
  readonly shimDir: string
}

/** `startLoop`'s own result: `{ ok: true }` once the child is spawned and registered, or the registry's one named refusal (a worktree already being driven is never double-driven) — never a queue. Owned here (the producer), not by `Router.ts` (the consumer) — mirrors `Write.ts#WriteResult`/`ReadSteeringFile.ts#ReadSteeringFileResult`/`Diff.ts#DiffResult`, each of which the router imports FROM, never the reverse. */
export type StartLoopResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DriveRefusalReason }

/**
 * Signals `pid`'s own process GROUP (`-pid`), never just `pid` itself: the
 * canonical loop shape (`docs/driver.md`'s own `while :; do ... claude ...;
 * done`) forks a new process per turn under the SAME bash — a bare
 * `child.kill(signal)` reaches only that top bash pid, never the driver it
 * forked, which then survives both the interrupt AND the escalation kill,
 * keeps committing to the worktree, and leaves `isDriving` false (T3's
 * double-drive guard) and the row Working with a live driver still inside it
 * once `bash` itself has died (T5/T6). `detached: true` at spawn (below)
 * makes this pid the group's own leader, so `-pid` reaches bash AND every
 * process it forked. `ESRCH` (group already gone — the whole thing already
 * exited) is swallowed; anything else rethrows.
 */
const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

/**
 * The loop process port's real spawn: `bash -c <command>` with `cwd` set to
 * the worktree and `shimDir` PREPENDED to `$PATH` — separate from
 * `CommandRunner` because a loop command needs a per-worktree cwd, a
 * shim-prepended `PATH`, real OS signal control while it's still running,
 * and never-combined stdout/stderr, none of which `CommandRunner`'s
 * single-shot "run to completion" shape supports (see `CommandRunner.ts`'s
 * own doc comment, amended in the same commit this port was added). A plain
 * function (mirroring `Beat.ts`'s `liveRunInWorktree`), not an Effect
 * service — `Server.ts` calls it directly, and `StartLoopDeps.spawn` (below)
 * is the injection seam tests use instead of a service layer. `detached:
 * true` makes this `bash` the leader of its own new process group (rather
 * than sharing `gtd ui`'s own) — see `signalGroup`'s own doc comment for
 * why `interrupt`/`kill` signal that whole group, not just this one pid.
 */
export const liveLoopSpawn = (request: LoopSpawnRequest): LoopChild => {
  const env = {
    ...process.env,
    PATH: `${request.shimDir}:${process.env["PATH"] ?? ""}`,
  }
  const child = spawn("bash", ["-c", request.command], {
    cwd: request.cwd,
    env,
    detached: true,
  })
  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8")
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8")
  })
  const wait = new Promise<LoopOutcome>((resolve) => {
    // `error` (spawn never happened at all) and `close` (it happened) are
    // mutually exclusive per Node's own contract, but `once` on both plus a
    // resolved flag keeps this correct even if that ever isn't quite true.
    // `close`, deliberately NOT `exit`: `exit` fires the moment the process
    // terminates, before its piped stdio is necessarily drained — a loop
    // command that writes a large tail to stderr right before exiting could
    // resolve `wait` with that tail still sitting unread in the pipe,
    // silently truncating `LoopOutcome.stdout`/`stderr` (and so
    // `Registry.ts#register`'s own `LoopFailure`, and `Fleet.tsx`'s
    // rendering of it) — exactly the output requirement 6 says must be
    // shown inline to distinguish one failure from another. `close` is
    // Node's own guarantee that every stdio stream has ended, mirroring
    // `Beat.ts#liveRunInWorktree`'s `execFile`, whose callback likewise
    // never fires until stdio is fully collected.
    let settled = false
    child.once("error", (error) => {
      if (settled) return
      settled = true
      resolve({ stdout, stderr, status: null, signal: null, spawnError: error.message })
    })
    child.once("close", (code, signal) => {
      if (settled) return
      settled = true
      resolve({ stdout, stderr, status: code, signal })
    })
  })
  return {
    wait,
    interrupt: () => {
      if (child.pid !== undefined) signalGroup(child.pid, "SIGINT")
    },
    kill: () => {
      if (child.pid !== undefined) signalGroup(child.pid, "SIGKILL")
    },
  }
}

/**
 * How long a child gets to finish its beat after SIGINT before SIGKILL
 * follows — a single named constant, not repeated at each call site.
 */
export const LOOP_STOP_ESCALATION_MS = 5_000

/**
 * SIGINT first, never SIGKILL first; a child that exits on its
 * own before `escalationMs` is never sent the kill signal at all. The
 * process re-raises SIGINT as a real signal death after its fiber unwinds
 * (`src/main.ts`'s own contract) — a genuine 130 for the loop's parent to
 * `wait` on, no new exit code needed.
 */
export const stopChild = (
  child: LoopChild,
  escalationMs: number = LOOP_STOP_ESCALATION_MS,
): Promise<LoopOutcome> => {
  child.interrupt()
  const timer = setTimeout(() => child.kill(), escalationMs)
  return child.wait.then((outcome) => {
    clearTimeout(timer)
    return outcome
  })
}

/** The done action's second half's own dependencies — injectable so `Router.test.ts`/`Loop.test.ts` never spawn a real subprocess or touch a real filesystem. */
export interface StartLoopDeps {
  readonly registry: Registry
  readonly spawn: (request: LoopSpawnRequest) => LoopChild
  /** Creates a fresh shim directory (see `Shim.ts#createShim`) resolved to THIS worktree's own local install when it has one — an `Effect` (not yet run) so this module never imports `FileSystem` itself. */
  readonly createShim: (worktreePath: string) => Effect.Effect<string, Error>
  /** `undefined` when `ui.loop` isn't configured — `startLoop` then rejects rather than spawning nothing useful. */
  readonly command: string | undefined
}

/** Best-effort recursive removal of a shim directory — a long-lived `gtd ui` would otherwise leak one temp directory per `done` action forever. Never throws: a cleanup failure (already gone, a permission quirk) is not worth failing anything over. */
const removeShimDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true }).catch(() => {})

/**
 * The done action, second half: write the steering file (the caller's job,
 * BEFORE calling this), then spawn the configured loop command and register
 * it — resolves once spawned, NEVER waiting for the child to exit.
 * `Registry.reserve`/`replace` (not a plain `isDriving` check then
 * `register`) close the race between checking and registering across the
 * `await` shim creation needs. Wrapped in `try`/`catch`: if shim creation
 * rejects or `deps.spawn` itself throws, `registry.release` frees the
 * reservation before rethrowing — otherwise that worktree would be pinned to
 * Working forever, refusing every later `done` as `already-driving` with no
 * real child ever having existed to exit and remove it; a shim already
 * created by that point is removed too, rather than left orphaned. Once the
 * child DOES exist, its shim directory is removed once it exits (`removeShimDir`) —
 * on any exit, clean or signalled — never before, since the shim's `PATH`
 * entry has to keep resolving `gtd` for as long as the child (or anything it
 * forked) might still call it.
 */
export const startLoop = async (
  worktreePath: string,
  deps: StartLoopDeps,
): Promise<StartLoopResult> => {
  if (deps.command === undefined) {
    throw new Error("gtd ui: no ui.loop command configured")
  }
  const id = worktreeId(worktreePath)
  if (!deps.registry.reserve(id)) return { ok: false, reason: "already-driving" }
  let shimDir: string | undefined
  try {
    shimDir = await Effect.runPromise(deps.createShim(worktreePath))
    const child = deps.spawn({ command: deps.command, cwd: worktreePath, shimDir })
    deps.registry.replace(id, child)
    const cleanup = shimDir
    void child.wait.finally(() => void removeShimDir(cleanup))
    return { ok: true }
  } catch (error) {
    deps.registry.release(id)
    if (shimDir !== undefined) void removeShimDir(shimDir)
    throw error
  }
}

/** A no-op, not an error, when nothing is live for `worktreePath`. */
export const stopLoop = async (worktreePath: string, registry: Registry): Promise<void> => {
  const child = registry.get(worktreeId(worktreePath))
  if (child === undefined) return
  await stopChild(child)
}
