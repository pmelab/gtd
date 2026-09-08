import { spawn } from "node:child_process"
import { Context, Effect, Layer } from "effect"
import { worktreeId } from "./Discover.js"
import type { Registry } from "./Registry.js"
import type { StartLoopResult } from "./Router.js"

/** One loop child's outcome — `stdout`/`stderr` arrive as two separate strings, NEVER combined (unlike `CommandRunner`'s `CommandOutcome.output`), because T2 never parses either for state and the done action only cares that the child exited. `signal` is set (and `status` `null`) on a signal death, matching `spawnSync`'s own contract. */
export interface LoopOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly status: number | null
  readonly signal: NodeJS.Signals | null
}

/** A live loop child: `interrupt`/`kill` send real OS signals to the actual process, not merely cancel an Effect fiber — `wait` resolves once the child has exited, on any exit, clean or signalled. */
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

/**
 * The real spawn: `bash -c <command>` with `cwd` set to the worktree and
 * `shimDir` PREPENDED to `$PATH` — a plain function (mirroring `Beat.ts`'s
 * `liveRunInWorktree`), not wrapped in an Effect service, so `Server.ts` can
 * call it directly without threading a runtime through for one function.
 */
export const liveLoopSpawn = (request: LoopSpawnRequest): LoopChild => {
  const env = {
    ...process.env,
    PATH: `${request.shimDir}:${process.env["PATH"] ?? ""}`,
  }
  const child = spawn("bash", ["-c", request.command], { cwd: request.cwd, env })
  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8")
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8")
  })
  const wait = new Promise<LoopOutcome>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ stdout, stderr, status: code, signal })
    })
  })
  return {
    wait,
    interrupt: () => {
      child.kill("SIGINT")
    },
    kill: () => {
      child.kill("SIGKILL")
    },
  }
}

/**
 * The loop process port: separate from `CommandRunner` because a loop
 * command needs a per-worktree cwd, a shim-prepended `PATH`, real OS signal
 * control while it's still running, and never-combined stdout/stderr — none
 * of which `CommandRunner`'s single-shot "run to completion" shape supports.
 * See `CommandRunner.ts`'s own doc comment, amended in the same commit. Kept
 * as an `Effect` service (mirroring `CommandRunner`) for symmetry and for
 * tests that want the full Effect-provided-layer shape; `Server.ts` itself
 * calls `liveLoopSpawn` directly.
 */
export class LoopRunner extends Context.Tag("LoopRunner")<
  LoopRunner,
  { readonly spawn: (request: LoopSpawnRequest) => LoopChild }
>() {
  /** A test layer over a canned `spawn` — no real subprocess. */
  static readonly layer = (
    spawnFn: (request: LoopSpawnRequest) => LoopChild,
  ): Layer.Layer<LoopRunner> => Layer.succeed(LoopRunner, { spawn: spawnFn })

  static readonly Live = Layer.succeed(LoopRunner, { spawn: liveLoopSpawn })
}

/**
 * T5's escalation timeout: how long a child gets to finish its beat after
 * SIGINT before SIGKILL follows — a single named constant, not repeated at
 * each call site.
 */
export const LOOP_STOP_ESCALATION_MS = 5_000

/**
 * T5's stop: SIGINT first, never SIGKILL first; a child that exits on its
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

/** T2's done-action second half's own dependencies — injectable so `Router.test.ts`/`Loop.test.ts` never spawn a real subprocess or touch a real filesystem. */
export interface StartLoopDeps {
  readonly registry: Registry
  readonly spawn: (request: LoopSpawnRequest) => LoopChild
  /** Creates a fresh shim directory (see `Shim.ts#createShim`) for one spawn — an `Effect` (not yet run) so this module never imports `FileSystem` itself. */
  readonly createShim: () => Effect.Effect<string, Error>
  /** `undefined` when `serve.loop` isn't configured — `startLoop` then rejects rather than spawning nothing useful. */
  readonly command: string | undefined
}

/**
 * T2's done action, second half: write the steering file (the caller's job,
 * BEFORE calling this), then spawn the configured loop command and register
 * it (T3) — resolves once spawned, NEVER waiting for the child to exit.
 * `Registry.reserve`/`replace` (not a plain `isDriving` check then
 * `register`) close the race between checking and registering across the
 * `await` shim creation needs.
 */
export const startLoop = async (
  worktreePath: string,
  deps: StartLoopDeps,
): Promise<StartLoopResult> => {
  if (deps.command === undefined) {
    throw new Error("gtd serve: no serve.loop command configured")
  }
  const id = worktreeId(worktreePath)
  if (!deps.registry.reserve(id)) return { ok: false, reason: "already-driving" }
  const shimDir = await Effect.runPromise(deps.createShim())
  const child = deps.spawn({ command: deps.command, cwd: worktreePath, shimDir })
  deps.registry.replace(id, child)
  return { ok: true }
}

/** T5's stop: a no-op, not an error, when nothing is live for `worktreePath`. */
export const stopLoop = async (worktreePath: string, registry: Registry): Promise<void> => {
  const child = registry.get(worktreeId(worktreePath))
  if (child === undefined) return
  await stopChild(child)
}
