import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { worktreeId } from "./Discover.js"
import {
  LOOP_STOP_ESCALATION_MS,
  LoopRunner,
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

describe("LoopRunner.Live", () => {
  it("runs the child with the worktree as cwd, the shim prepended to PATH, and separate stdout/stderr", async () => {
    const child = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* LoopRunner
        return runner.spawn({
          command: 'echo "cwd:$(pwd)"; gtd check qa file.md; echo err >&2',
          cwd: tmpDir,
          shimDir,
        })
      }).pipe(Effect.provide(LoopRunner.Live)),
    )
    const outcome = await child.wait
    expect(outcome.status).toBe(0)
    expect(outcome.stdout).toContain(`cwd:${tmpDir}`)
    expect(outcome.stdout).toContain("gtd-shim:check qa file.md")
    expect(outcome.stderr.trim()).toBe("err")
  })

  it("a bare gtd resolves to the shim, not whatever gtd is on the inherited PATH", async () => {
    const child = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* LoopRunner
        return runner.spawn({ command: "gtd --version", cwd: tmpDir, shimDir })
      }).pipe(Effect.provide(LoopRunner.Live)),
    )
    const outcome = await child.wait
    expect(outcome.stdout).toContain("gtd-shim:--version")
  })

  it("two worktrees driven at once each get their own shim, with no crosstalk", async () => {
    const otherShimDir = mkdtempSync(join(tmpdir(), "gtd-loop-shim2-"))
    writeFileSync(join(otherShimDir, "gtd"), '#!/bin/sh\necho "other-shim:$*"\n', { mode: 0o755 })
    try {
      const { a, b } = await Effect.runPromise(
        Effect.gen(function* () {
          const runner = yield* LoopRunner
          const first = runner.spawn({ command: "gtd x", cwd: tmpDir, shimDir })
          const second = runner.spawn({ command: "gtd y", cwd: tmpDir, shimDir: otherShimDir })
          return {
            a: yield* Effect.promise(() => first.wait),
            b: yield* Effect.promise(() => second.wait),
          }
        }).pipe(Effect.provide(LoopRunner.Live)),
      )
      expect(a.stdout).toContain("gtd-shim:x")
      expect(b.stdout).toContain("other-shim:y")
    } finally {
      rmSync(otherShimDir, { recursive: true, force: true })
    }
  })
})

describe("LoopRunner.layer", () => {
  it("provides a canned spawn — no real subprocess", async () => {
    const canned: LoopChild = {
      wait: Promise.resolve({ stdout: "fake", stderr: "", status: 0, signal: null }),
      interrupt: vi.fn(),
      kill: vi.fn(),
    }
    const child = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* LoopRunner
        return runner.spawn({ command: "irrelevant", cwd: tmpDir, shimDir: tmpDir })
      }).pipe(Effect.provide(LoopRunner.layer(() => canned))),
    )
    expect(child).toBe(canned)
    expect((await child.wait).stdout).toBe("fake")
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
})
