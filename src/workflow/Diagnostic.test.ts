import { describe, expect, it } from "vitest"
import {
  compareConfigPaths,
  dedupeDiagnostics,
  formatDiagnostic,
  sortDiagnostics,
  type Diagnostic,
} from "./Diagnostic.js"

const diag = (over: Partial<Diagnostic>): Diagnostic => ({
  severity: "error",
  message: "boom",
  path: [],
  origin: "/repo/gtd.config.ts",
  ...over,
})

describe("compareConfigPaths", () => {
  it("orders numeric segments numerically, not lexicographically", () => {
    expect(compareConfigPaths(["on", 2], ["on", 10])).toBeLessThan(0)
  })

  it("orders string segments lexicographically", () => {
    expect(compareConfigPaths(["a"], ["b"])).toBeLessThan(0)
  })

  it("orders a shorter path before a longer one sharing a common prefix", () => {
    expect(
      compareConfigPaths(["machines", "design"], ["machines", "design", "states"]),
    ).toBeLessThan(0)
  })

  it("is zero for identical paths", () => {
    expect(compareConfigPaths(["machines", "design"], ["machines", "design"])).toBe(0)
  })
})

describe("sortDiagnostics", () => {
  it("sorts by config path", () => {
    const a = diag({ path: ["on", 2] })
    const b = diag({ path: ["on", 10] })
    expect(sortDiagnostics([b, a])).toEqual([a, b])
  })
})

describe("dedupeDiagnostics", () => {
  it("collapses two findings identical in all four fields to one", () => {
    const first = diag({ origin: "/repo/gtd.config.ts" })
    const second = diag({ origin: "/repo/gtd.config.ts" })
    expect(dedupeDiagnostics([first, second])).toEqual([first])
  })

  it("keeps two findings that differ only by path", () => {
    const a = diag({ path: ["a"] })
    const b = diag({ path: ["b"] })
    expect(dedupeDiagnostics([a, b])).toEqual([a, b])
  })

  it("keeps two findings that differ only by severity", () => {
    const a = diag({ severity: "error" })
    const b = diag({ severity: "warning" })
    expect(dedupeDiagnostics([a, b])).toEqual([a, b])
  })
})

describe("formatDiagnostic", () => {
  it("renders `<origin>: <config.path>: <message>`", () => {
    const d = diag({
      origin: "/repo/gtd.config.ts",
      path: ["machines", "root", "states", "idle", "on", "* **"],
      message: 'state "idle": "on" target "nowhere" is not a defined state',
    })
    expect(formatDiagnostic(d)).toBe(
      '/repo/gtd.config.ts: machines.root.states.idle.on.* **: state "idle": "on" target "nowhere" is not a defined state',
    )
  })

  it("renders a top-level (path-less) finding with a `(top level)` path placeholder", () => {
    const d = diag({
      origin: "/repo/gtd.config.ts",
      path: [],
      message: "unknown top-level key(s) foo",
    })
    expect(formatDiagnostic(d)).toBe(
      "/repo/gtd.config.ts: (top level): unknown top-level key(s) foo",
    )
  })

  it("joins a numeric path segment the same as a string one", () => {
    const d = diag({ origin: "/repo/gtd.config.ts", path: ["on", 2], message: "boom" })
    expect(formatDiagnostic(d)).toBe("/repo/gtd.config.ts: on.2: boom")
  })
})
