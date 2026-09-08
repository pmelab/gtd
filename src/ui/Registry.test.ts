import { describe, expect, it, vi } from "vitest"
import type { LoopChild, LoopOutcome } from "./Loop.js"
import { FOREIGN_DRIVER_FRESHNESS_MS, Registry } from "./Registry.js"

const fakeOutcome: LoopOutcome = { stdout: "", stderr: "", status: 0, signal: null }

const fakeChild = (): { child: LoopChild; exit: () => void } => {
  let resolveWait: (outcome: LoopOutcome) => void = () => {}
  const wait = new Promise<LoopOutcome>((resolve) => {
    resolveWait = resolve
  })
  return {
    child: { wait, interrupt: vi.fn(), kill: vi.fn() },
    exit: () => resolveWait(fakeOutcome),
  }
}

/** Like `fakeChild`, but `exit` resolves with an arbitrary outcome — for `lastLoopFailure`'s own tests, which care about exactly what the child reported. */
const fakeChildWithOutcome = (): { child: LoopChild; exit: (outcome: LoopOutcome) => void } => {
  let resolveWait: (outcome: LoopOutcome) => void = () => {}
  const wait = new Promise<LoopOutcome>((resolve) => {
    resolveWait = resolve
  })
  return {
    child: { wait, interrupt: vi.fn(), kill: vi.fn() },
    exit: (outcome) => resolveWait(outcome),
  }
}

/** Flushes the microtask queue past `register`'s own `.then().finally()` chain — needed because that chain's `LoopFailure` recording runs one tick after `child.wait` resolves. */
const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("Registry", () => {
  it("refuses nothing itself, but reports a worktree with a live child as driving", () => {
    const registry = new Registry()
    const { child } = fakeChild()
    expect(registry.isDriving("a")).toBe(false)
    registry.register("a", child)
    expect(registry.isDriving("a")).toBe(true)
  })

  it("removes the entry once the child exits cleanly, so a later done action succeeds", async () => {
    const registry = new Registry()
    const { child, exit } = fakeChild()
    registry.register("a", child)
    exit()
    await child.wait
    // allow the .finally() microtask queued in register() to run
    await Promise.resolve()
    await Promise.resolve()
    expect(registry.isDriving("a")).toBe(false)
  })

  it("removes the entry when the child dies by signal, not only on a clean exit", async () => {
    const registry = new Registry()
    let resolveWait: (outcome: LoopOutcome) => void = () => {}
    const wait = new Promise<LoopOutcome>((resolve) => {
      resolveWait = resolve
    })
    const child: LoopChild = { wait, interrupt: vi.fn(), kill: vi.fn() }
    registry.register("a", child)
    resolveWait({ stdout: "", stderr: "", status: null, signal: "SIGINT" })
    await wait
    await Promise.resolve()
    await Promise.resolve()
    expect(registry.isDriving("a")).toBe(false)
  })

  it("drives two different worktrees concurrently, unlimited by explicit decision", () => {
    const registry = new Registry()
    registry.register("a", fakeChild().child)
    registry.register("b", fakeChild().child)
    expect(registry.isDriving("a")).toBe(true)
    expect(registry.isDriving("b")).toBe(true)
  })

  it("get returns the live child for a driven worktree, undefined otherwise", () => {
    const registry = new Registry()
    const { child } = fakeChild()
    registry.register("a", child)
    expect(registry.get("a")).toBe(child)
    expect(registry.get("b")).toBeUndefined()
  })

  it("killAll kills every live child and forgets them all", () => {
    const registry = new Registry()
    const { child: a } = fakeChild()
    const { child: b } = fakeChild()
    registry.register("a", a)
    registry.register("b", b)
    registry.killAll()
    expect(a.kill).toHaveBeenCalledTimes(1)
    expect(b.kill).toHaveBeenCalledTimes(1)
    expect(registry.isDriving("a")).toBe(false)
    expect(registry.isDriving("b")).toBe(false)
  })

  describe("reserve/replace", () => {
    it("reserve claims an undriven worktree and reports it as driving immediately", () => {
      const registry = new Registry()
      expect(registry.reserve("a")).toBe(true)
      expect(registry.isDriving("a")).toBe(true)
    })

    it("reserve refuses (no-op) when already driving", () => {
      const registry = new Registry()
      registry.register("a", fakeChild().child)
      expect(registry.reserve("a")).toBe(false)
    })

    it("replace swaps the placeholder for the real child, which is later removed on its own exit", async () => {
      const registry = new Registry()
      registry.reserve("a")
      const { child, exit } = fakeChild()
      registry.replace("a", child)
      expect(registry.get("a")).toBe(child)
      exit()
      await child.wait
      await Promise.resolve()
      await Promise.resolve()
      expect(registry.isDriving("a")).toBe(false)
    })

    it("get returns undefined for a bare reservation — nothing real exists yet to signal, so stop must read it as a no-op, never hang against it", () => {
      const registry = new Registry()
      registry.reserve("a")
      expect(registry.isDriving("a")).toBe(true)
      expect(registry.get("a")).toBeUndefined()
    })

    it("release frees a bare reservation, so a later reserve for the same worktree succeeds", () => {
      const registry = new Registry()
      registry.reserve("a")
      registry.release("a")
      expect(registry.isDriving("a")).toBe(false)
      expect(registry.reserve("a")).toBe(true)
    })

    it("release is a no-op once replace installed the real child — never undoes a real registration", () => {
      const registry = new Registry()
      registry.reserve("a")
      const { child } = fakeChild()
      registry.replace("a", child)
      registry.release("a")
      expect(registry.get("a")).toBe(child)
      expect(registry.isDriving("a")).toBe(true)
    })

    it("release on a worktree with no entry at all is a no-op", () => {
      const registry = new Registry()
      expect(() => registry.release("nothing-here")).not.toThrow()
      expect(registry.isDriving("nothing-here")).toBe(false)
    })
  })

  describe("possiblyForeignDriven", () => {
    it("a registry entry always wins over the log signal", () => {
      const registry = new Registry()
      registry.register("a", fakeChild().child)
      expect(registry.possiblyForeignDriven("a", 1000, 1000)).toBe(false)
    })

    it("a recently touched log with no registry entry reads as possibly driven elsewhere", () => {
      const registry = new Registry()
      const now = 1_000_000
      expect(registry.possiblyForeignDriven("a", now - 1_000, now)).toBe(true)
    })

    it("a stale log with no registry entry does not read as driven", () => {
      const registry = new Registry()
      const now = 1_000_000
      expect(registry.possiblyForeignDriven("a", now - FOREIGN_DRIVER_FRESHNESS_MS - 1, now)).toBe(
        false,
      )
    })

    it("a worktree with no log file at all does not read as driven", () => {
      const registry = new Registry()
      expect(registry.possiblyForeignDriven("a", undefined, 1_000_000)).toBe(false)
    })
  })

  describe("lastLoopFailure", () => {
    it("records a non-zero exit's stdout/stderr/status, readable after the row leaves Working", async () => {
      const registry = new Registry()
      const { child, exit } = fakeChildWithOutcome()
      registry.register("a", child)
      exit({
        stdout: "trying to run\n",
        stderr: "gtd: command not found\n",
        status: 127,
        signal: null,
      })
      await child.wait
      await flushMicrotasks()
      expect(registry.isDriving("a")).toBe(false)
      expect(registry.lastLoopFailure("a")).toEqual({
        stdout: "trying to run\n",
        stderr: "gtd: command not found\n",
        status: 127,
      })
    })

    it("records a spawn failure (vanished worktree) the same way", async () => {
      const registry = new Registry()
      const { child, exit } = fakeChildWithOutcome()
      registry.register("a", child)
      exit({ stdout: "", stderr: "", status: null, signal: null, spawnError: "spawn bash ENOENT" })
      await child.wait
      await flushMicrotasks()
      expect(registry.lastLoopFailure("a")).toEqual({
        stdout: "",
        stderr: "",
        status: null,
        spawnError: "spawn bash ENOENT",
      })
    })

    it("never records a signal death as a failure — that's stop's own doing, not a failure", async () => {
      const registry = new Registry()
      const { child, exit } = fakeChildWithOutcome()
      registry.register("a", child)
      exit({ stdout: "", stderr: "", status: null, signal: "SIGINT" })
      await child.wait
      await flushMicrotasks()
      expect(registry.lastLoopFailure("a")).toBeUndefined()
    })

    it("never records a clean exit", async () => {
      const registry = new Registry()
      const { child, exit } = fakeChild()
      registry.register("a", child)
      exit()
      await child.wait
      await flushMicrotasks()
      expect(registry.lastLoopFailure("a")).toBeUndefined()
    })

    it("clears a prior failure once the same worktree is driven again", async () => {
      const registry = new Registry()
      const first = fakeChildWithOutcome()
      registry.register("a", first.child)
      first.exit({ stdout: "", stderr: "boom", status: 1, signal: null })
      await first.child.wait
      await flushMicrotasks()
      expect(registry.lastLoopFailure("a")).toBeDefined()

      const second = fakeChild()
      registry.register("a", second.child)
      expect(registry.lastLoopFailure("a")).toBeUndefined()
    })

    it("is undefined for a worktree that has never been driven", () => {
      const registry = new Registry()
      expect(registry.lastLoopFailure("never-driven")).toBeUndefined()
    })
  })
})
