import { describe, expect, it } from "vitest"
import {
  BUILT_IN_ORIGIN,
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
  origin: "/repo/.gtdrc",
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
  it("sorts outermost layer to innermost, per the given layer order", () => {
    const outer = diag({ origin: "/home/.gtdrc", path: ["a"] })
    const inner = diag({ origin: "/repo/.gtdrc", path: ["a"] })
    const sorted = sortDiagnostics([inner, outer], ["/home/.gtdrc", "/repo/.gtdrc"])
    expect(sorted).toEqual([outer, inner])
  })

  it("always sorts the built-in default last, even before an origin not in layerOrder", () => {
    const builtin = diag({ origin: BUILT_IN_ORIGIN, path: ["a"] })
    const layer = diag({ origin: "/repo/.gtdrc", path: ["a"] })
    const sorted = sortDiagnostics([builtin, layer], ["/repo/.gtdrc"])
    expect(sorted).toEqual([layer, builtin])
  })

  it("still sorts the built-in default last even behind an origin genuinely absent from layerOrder", () => {
    const builtin = diag({ origin: BUILT_IN_ORIGIN, path: ["a"] })
    // "/unknown/.gtdrc" is NOT in the layerOrder passed below — an origin
    // `sortDiagnostics` has never seen still ranks ahead of BUILT_IN_ORIGIN.
    const unknown = diag({ origin: "/unknown/.gtdrc", path: ["a"] })
    const sorted = sortDiagnostics([builtin, unknown], ["/repo/.gtdrc"])
    expect(sorted).toEqual([unknown, builtin])
  })

  it("within one origin, sorts by config path", () => {
    const a = diag({ origin: "/repo/.gtdrc", path: ["on", 2] })
    const b = diag({ origin: "/repo/.gtdrc", path: ["on", 10] })
    const sorted = sortDiagnostics([b, a], ["/repo/.gtdrc"])
    expect(sorted).toEqual([a, b])
  })
})

describe("dedupeDiagnostics", () => {
  it("keeps two findings identical in severity, path, and message but differing in origin", () => {
    const first = diag({ origin: "/home/.gtdrc" })
    const second = diag({ origin: "/repo/.gtdrc" })
    expect(dedupeDiagnostics([first, second])).toEqual([first, second])
  })

  it("collapses two findings identical in all four fields to one", () => {
    const first = diag({ origin: "/repo/.gtdrc" })
    const second = diag({ origin: "/repo/.gtdrc" })
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
      origin: "/repo/.gtdrc",
      path: ["machines", "root", "states", "idle", "on", "* **"],
      message: 'state "idle": "on" target "nowhere" is not a defined state',
    })
    expect(formatDiagnostic(d)).toBe(
      '/repo/.gtdrc: machines.root.states.idle.on.* **: state "idle": "on" target "nowhere" is not a defined state',
    )
  })

  it("renders a top-level (path-less) finding with a `(top level)` path placeholder", () => {
    const d = diag({ origin: "/repo/.gtdrc", path: [], message: "unknown top-level key(s) foo" })
    expect(formatDiagnostic(d)).toBe("/repo/.gtdrc: (top level): unknown top-level key(s) foo")
  })

  it("renders the built-in default's origin literally", () => {
    const d = diag({ origin: BUILT_IN_ORIGIN, path: ["states", "idle"], message: "boom" })
    expect(formatDiagnostic(d)).toBe("(built-in default): states.idle: boom")
  })

  it("joins a numeric path segment the same as a string one", () => {
    const d = diag({ origin: "/repo/.gtdrc", path: ["on", 2], message: "boom" })
    expect(formatDiagnostic(d)).toBe("/repo/.gtdrc: on.2: boom")
  })
})
