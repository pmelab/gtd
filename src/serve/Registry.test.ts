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
})
