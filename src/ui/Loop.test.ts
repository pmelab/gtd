import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { worktreeId } from "./Discover.js"
import {
  LOOP_STOP_ESCALATION_MS,
  liveLoopSpawn,
  startLoop,
  stopLoop,
  type LoopChild,
  type LoopOutcome,
  type LoopSpawnRequest,
  stopChild,
} from "./Loop.js"
import { Registry } from "./Registry.js"

let tmpDir: string
let shimDir: string

beforeEach(() => {
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "gtd-loop-test-")))
  shimDir = mkdtempSync(join(tmpdir(), "gtd-loop-shim-"))
  writeFileSync(join(shimDir, "gtd"), '#!/bin/sh\necho "gtd-shim:$*"\n', { mode: 0o755 })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  rmSync(shimDir, { recursive: true, force: true })
})

describe("liveLoopSpawn", () => {
  it("runs the child with the worktree as cwd, the shim prepended to PATH, and separate stdout/stderr", async () => {
    const child = liveLoopSpawn({
      command: 'echo "cwd:$(pwd)"; gtd check qa file.md; echo err >&2',
      cwd: tmpDir,
      shimDir,
    })
    const outcome = await child.wait
    expect(outcome.status).toBe(0)
    expect(outcome.stdout).toContain(`cwd:${tmpDir}`)
    expect(outcome.stdout).toContain("gtd-shim:check qa file.md")
    expect(outcome.stderr.trim()).toBe("err")
  })

  it("a bare gtd resolves to the shim, not whatever gtd is on the inherited PATH", async () => {
    const child = liveLoopSpawn({ command: "gtd --version", cwd: tmpDir, shimDir })
    const outcome = await child.wait
    expect(outcome.stdout).toContain("gtd-shim:--version")
  })

  it("two worktrees driven at once each get their own shim, with no crosstalk", async () => {
    const otherShimDir = mkdtempSync(join(tmpdir(), "gtd-loop-shim2-"))
    writeFileSync(join(otherShimDir, "gtd"), '#!/bin/sh\necho "other-shim:$*"\n', { mode: 0o755 })
    try {
      const first = liveLoopSpawn({ command: "gtd x", cwd: tmpDir, shimDir })
      const second = liveLoopSpawn({ command: "gtd y", cwd: tmpDir, shimDir: otherShimDir })
      const [a, b] = await Promise.all([first.wait, second.wait])
      expect(a.stdout).toContain("gtd-shim:x")
      expect(b.stdout).toContain("other-shim:y")
    } finally {
      rmSync(otherShimDir, { recursive: true, force: true })
    }
  })
})

/** `true` while `pid` is a live process (`ESRCH` is the only "definitely dead" signal — any other error, e.g. `EPERM`, means it still exists but we can't signal it, which still counts as alive here). */
const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

/** Polls until `pid` is no longer alive — `stopChild`/`killAll` both signal asynchronously (neither one's own return/resolution is a synchronous guarantee that the OS has already reaped the process), so a single immediate check would be racy. */
const waitUntilDead = async (pid: number, timeoutMs = 2_000): Promise<void> => {
  const start = Date.now()
  while (isAlive(pid)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`pid ${pid} is still alive after ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Polls until `path` no longer exists — `startLoop`'s own shim cleanup is fire-and-forget real (async) filesystem I/O, not something a synchronous check right after can observe reliably. */
const waitUntilRemoved = async (path: string, timeoutMs = 2_000): Promise<void> => {
  const start = Date.now()
  while (existsSync(path)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${path} is still present after ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Polls until `path` exists with non-empty content, returning it parsed as a pid — the loop command below writes its forked grandchild's pid to a file since `LoopChild` exposes no live stdout tap to scrape one out of mid-flight. */
const readPidFileWhenReady = async (path: string, timeoutMs = 2_000): Promise<number> => {
  const start = Date.now()
  while (true) {
    if (existsSync(path)) {
      const content = readFileSync(path, "utf8").trim()
      if (content.length > 0) return Number(content)
    }
    if (Date.now() - start > timeoutMs) throw new Error(`${path} never appeared`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/**
 * Reproduces the canonical loop shape (`docs/driver.md`'s own `while :; do
 * ... claude ...; done`, which runs the agent turn in the FOREGROUND of that
 * loop, never backgrounded with `&`) — a `bash -c` loop whose body forks a
 * separate process per turn under the same top-level bash. A bare signal to
 * that top bash pid alone never reaches the forked turn — these pin that
 * `stopChild`/`Registry.killAll` instead signal the WHOLE process group
 * `liveLoopSpawn` makes this `bash` the leader of, so the forked grandchild
 * dies too, not just the wrapper. `exec sleep 30` (not `sleep 30 &`, which
 * this failed against earlier): a BACKGROUNDED job is a materially different
 * case — POSIX has the shell set `&` jobs' own SIGINT/SIGQUIT disposition to
 * ignored specifically so an interactive Ctrl-C doesn't kill background work
 * by accident, which would fail this test for a reason that has nothing to
 * do with process-group signaling at all. `exec` replaces the inner `sh`
 * with `sleep` in place (same pid) so the recorded pid is live regardless of
 * which image is currently running under it.
 */
describe("process-group signaling — a loop's forked grandchild dies too, not just bash itself", () => {
  const grandchildLoopCommand = (pidFile: string): string =>
    `while true; do sh -c 'echo $$ > "${pidFile}"; exec sleep 30'; done`

  it("stopChild kills the long-running process the loop's own bash forked", async () => {
    const pidFile = join(tmpDir, "grandchild-stop.pid")
    const child = liveLoopSpawn({ command: grandchildLoopCommand(pidFile), cwd: tmpDir, shimDir })
    const grandchildPid = await readPidFileWhenReady(pidFile)
    expect(isAlive(grandchildPid)).toBe(true)

    await stopChild(child)

    await waitUntilDead(grandchildPid)
  })

  it("Registry.killAll kills the same forked grandchild, not just the registered wrapper", async () => {
    const pidFile = join(tmpDir, "grandchild-killall.pid")
    const child = liveLoopSpawn({ command: grandchildLoopCommand(pidFile), cwd: tmpDir, shimDir })
    const grandchildPid = await readPidFileWhenReady(pidFile)
    expect(isAlive(grandchildPid)).toBe(true)

    const registry = new Registry()
    registry.register("w", child)
    registry.killAll()
    await child.wait

    await waitUntilDead(grandchildPid)
  })
})

/**
 * `close`, not `exit`: `exit` fires the instant the process terminates,
 * before its piped stdio is necessarily drained, so a large tail written
 * right before exit can still be sitting in the pipe, unread, when `exit`
 * fires — silently truncating the captured output. 300 KB comfortably
 * exceeds a single pipe buffer (64 KB on both Linux and macOS), so a naive
 * `exit`-based `wait` would resolve here with a short read; `close` never
 * does.
 */
describe("liveLoopSpawn — output larger than one pipe buffer, written immediately before exit", () => {
  it("captures the full output, not a pipe-buffer-sized prefix of it", async () => {
    const child = liveLoopSpawn({
      command: "head -c 300000 /dev/zero | tr '\\0' 'a'",
      cwd: tmpDir,
      shimDir,
    })
    const outcome = await child.wait
    expect(outcome.status).toBe(0)
    expect(outcome.stdout).toHaveLength(300_000)
    expect(outcome.stdout).toBe("a".repeat(300_000))
  })
})

describe("liveLoopSpawn — spawn failure", () => {
  it("resolves wait with spawnError set, rather than throwing or hanging, when the process can never start (a vanished cwd)", async () => {
    // A cwd that doesn't exist reliably fails the spawn itself (Node emits
    // `error`, never `exit`, for this) — mirrors "a worktree removed between
    // the fleet read and the done action".
    const child = liveLoopSpawn({
      command: "echo unreachable",
      cwd: join(tmpDir, "does-not-exist"),
      shimDir,
    })
    const outcome = await child.wait
    expect(outcome.status).toBeNull()
    expect(outcome.signal).toBeNull()
    expect(outcome.spawnError).toBeDefined()
    expect(outcome.stdout).toBe("")
  })
})

const fakeOutcome: LoopOutcome = { stdout: "", stderr: "", status: 0, signal: null }

const fakeChild = (over: Partial<LoopChild> = {}): { child: LoopChild; resolve: () => void } => {
  let resolveWait: (outcome: LoopOutcome) => void = () => {}
  const wait = new Promise<LoopOutcome>((resolve) => {
    resolveWait = resolve
  })
  return {
    child: {
      wait,
      interrupt: vi.fn(),
      kill: vi.fn(),
      ...over,
    },
    resolve: () => resolveWait(fakeOutcome),
  }
}

describe("stopChild", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("sends interrupt first, never kill first", async () => {
    const { child, resolve } = fakeChild()
    const promise = stopChild(child)
    expect(child.interrupt).toHaveBeenCalledTimes(1)
    expect(child.kill).not.toHaveBeenCalled()
    resolve()
    await promise
  })

  it("never sends kill when the child exits on its own before the escalation timeout", async () => {
    const { child, resolve } = fakeChild()
    const promise = stopChild(child)
    resolve()
    await promise
    vi.advanceTimersByTime(LOOP_STOP_ESCALATION_MS + 1)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it("sends kill once the child is still alive after the escalation timeout", async () => {
    const { child, resolve } = fakeChild()
    const promise = stopChild(child)
    vi.advanceTimersByTime(LOOP_STOP_ESCALATION_MS + 1)
    expect(child.kill).toHaveBeenCalledTimes(1)
    resolve()
    await promise
  })

  it("uses a single named escalation-timeout constant", () => {
    expect(LOOP_STOP_ESCALATION_MS).toBeGreaterThan(0)
  })
})

describe("startLoop", () => {
  it("writes nothing itself and spawns via the given cwd/command with a fresh shim, then registers the child", async () => {
    const registry = new Registry()
    const spawnCalls: LoopSpawnRequest[] = []
    const { child } = fakeChild()
    const spawn = vi.fn((request: LoopSpawnRequest) => {
      spawnCalls.push(request)
      return child
    })
    const result = await startLoop("/repos/x", {
      registry,
      spawn,
      createShim: () => Effect.succeed("/shim/dir"),
      command: "npm run loop",
    })
    expect(result).toEqual({ ok: true })
    expect(spawnCalls).toEqual([{ command: "npm run loop", cwd: "/repos/x", shimDir: "/shim/dir" }])
    expect(registry.isDriving(worktreeId("/repos/x"))).toBe(true)
  })

  it("refuses with already-driving when the worktree is already registered, never spawning", async () => {
    const registry = new Registry()
    registry.register(worktreeId("/repos/x"), fakeChild().child)
    const spawn = vi.fn(() => fakeChild().child)
    const result = await startLoop("/repos/x", {
      registry,
      spawn,
      createShim: () => Effect.succeed("/shim/dir"),
      command: "npm run loop",
    })
    expect(result).toEqual({ ok: false, reason: "already-driving" })
    expect(spawn).not.toHaveBeenCalled()
  })

  it("rejects when no loop command is configured", async () => {
    const registry = new Registry()
    await expect(
      startLoop("/repos/x", {
        registry,
        spawn: vi.fn(),
        createShim: () => Effect.succeed("/shim/dir"),
        command: undefined,
      }),
    ).rejects.toThrow()
  })

  it("releases the reservation when shim creation fails, so a later done action is not refused already-driving forever", async () => {
    const registry = new Registry()
    const spawn = vi.fn()
    await expect(
      startLoop("/repos/x", {
        registry,
        spawn,
        createShim: () => Effect.fail(new Error("temp dir unwritable")),
        command: "npm run loop",
      }),
    ).rejects.toThrow("temp dir unwritable")
    expect(spawn).not.toHaveBeenCalled()
    expect(registry.isDriving(worktreeId("/repos/x"))).toBe(false)

    // Proves the release actually took effect, not just that isDriving lies:
    // a second call must be able to reserve and spawn normally.
    const { child } = fakeChild()
    const retry = await startLoop("/repos/x", {
      registry,
      spawn: () => child,
      createShim: () => Effect.succeed("/shim/dir"),
      command: "npm run loop",
    })
    expect(retry).toEqual({ ok: true })
  })

  it("releases the reservation when spawn itself throws synchronously", async () => {
    const registry = new Registry()
    const spawn = vi.fn(() => {
      throw new Error("spawn EMFILE")
    })
    await expect(
      startLoop("/repos/x", {
        registry,
        spawn,
        createShim: () => Effect.succeed("/shim/dir"),
        command: "npm run loop",
      }),
    ).rejects.toThrow("spawn EMFILE")
    expect(registry.isDriving(worktreeId("/repos/x"))).toBe(false)
  })

  it("removes the shim directory once the child exits — a long-lived gtd ui must not leak one per done action", async () => {
    const registry = new Registry()
    const realShimDir = mkdtempSync(join(tmpDir, "gtd-real-shim-"))
    const { child, resolve } = fakeChild()
    await startLoop("/repos/x", {
      registry,
      spawn: () => child,
      createShim: () => Effect.succeed(realShimDir),
      command: "npm run loop",
    })
    expect(existsSync(realShimDir)).toBe(true)
    resolve()
    await child.wait
    // The removal is chained onto the SAME `child.wait` promise the caller
    // just awaited, but as its own fire-and-forget `.finally` doing REAL
    // (async, libuv-threadpool) filesystem I/O — a couple of microtask
    // ticks isn't a guarantee it has actually finished, so poll instead.
    await waitUntilRemoved(realShimDir)
  })

  it("removes an already-created shim directory when spawn itself throws after shim creation succeeded", async () => {
    const registry = new Registry()
    const realShimDir = mkdtempSync(join(tmpDir, "gtd-real-shim-"))
    await expect(
      startLoop("/repos/x", {
        registry,
        spawn: () => {
          throw new Error("spawn EMFILE")
        },
        createShim: () => Effect.succeed(realShimDir),
        command: "npm run loop",
      }),
    ).rejects.toThrow("spawn EMFILE")
    await waitUntilRemoved(realShimDir)
  })
})

describe("stopLoop", () => {
  it("is a no-op, not an error, on a worktree with no live child", async () => {
    const registry = new Registry()
    await expect(stopLoop("/repos/nothing-here", registry)).resolves.toBeUndefined()
  })

  it("sends the interrupt signal to the registered child for that worktree", async () => {
    const registry = new Registry()
    const { child, resolve } = fakeChild()
    registry.register(worktreeId("/repos/x"), child)
    const promise = stopLoop("/repos/x", registry)
    expect(child.interrupt).toHaveBeenCalledTimes(1)
    resolve()
    await promise
  })

  it("is a genuine no-op, never a hang, against a worktree still mid-reservation (no real child yet)", async () => {
    const registry = new Registry()
    registry.reserve(worktreeId("/repos/x"))
    // If this ever awaited the placeholder's own never-resolving `wait`
    // (Registry.reserve's `wait: new Promise(() => {})`), this would hang
    // the test until its timeout rather than resolving promptly.
    await expect(stopLoop("/repos/x", registry)).resolves.toBeUndefined()
  })
})
