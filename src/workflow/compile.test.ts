import { describe, expect, it } from "vitest"
import { compileWorkflow } from "./index.js"
import type { ConfigLayer } from "./compile.js"
import type { WorkflowFiles } from "./WorkflowFiles.js"

const noFiles: WorkflowFiles = { read: () => undefined }

const layer = (origin: string, value: unknown, dir = "/"): ConfigLayer => ({ origin, dir, value })

const validState = (on: Record<string, unknown> = {}) => ({
  actor: "human",
  message: "hi",
  on,
})

/**
 * Table tests over `compileWorkflow` itself — no IO, no Effect — pinning the
 * ordering and dedup contract this package exists to make testable: today
 * the merge came from three independent producers each pushing onto one
 * shared `errors: string[]`, sorted/deduped nowhere in particular. Here it's
 * one pure function's own return value.
 */
describe("compileWorkflow — with no config layers at all", () => {
  it("falls back to the built-in default workflow, with no diagnostics", () => {
    const result = compileWorkflow([], noFiles)
    expect(result.diagnostics).toEqual([])
    expect(Object.keys(result.workflow.states).length).toBeGreaterThan(0)
  })
})

describe("compileWorkflow — diagnostic ordering, outermost layer to innermost", () => {
  it("sorts a finding from the outer (ancestor) layer before one from the inner (cwd) layer", () => {
    const outer: ConfigLayer = layer("/home/.gtdrc", {
      workflow: {
        entry: { default: "root" },
        machines: { root: { entry: "a", states: { a: validState({ "* **": "nowhere" }) } } },
      },
    })
    const inner: ConfigLayer = layer("/repo/.gtdrc", { vars: { bad: { nested: true } } })

    const result = compileWorkflow([outer, inner], noFiles)
    const origins = result.diagnostics.filter((d) => d.severity === "error").map((d) => d.origin)

    expect(origins.indexOf("/home/.gtdrc")).toBeGreaterThanOrEqual(0)
    expect(origins.indexOf("/repo/.gtdrc")).toBeGreaterThanOrEqual(0)
    expect(origins.indexOf("/home/.gtdrc")).toBeLessThan(origins.indexOf("/repo/.gtdrc"))
  })

  it("attributes a real layer's own finding to that layer, never BUILT_IN_ORIGIN, when the workflow itself is unconfigured", () => {
    // `vars:` comes from a real layer (origin = that layer's file); the
    // workflow itself is unconfigured, so the built-in default's own
    // (clean) validation contributes nothing here — every finding in this
    // scenario is the layer's own.
    const layers: ConfigLayer[] = [layer("/repo/.gtdrc", { vars: { bad: { nested: true } } })]
    const result = compileWorkflow(layers, noFiles)
    const sorted = result.diagnostics.filter((d) => d.severity === "error")
    expect(sorted.length).toBeGreaterThan(0)
    expect(sorted.every((d) => d.origin === "/repo/.gtdrc")).toBe(true)
  })

  it("within one origin, sorts by config path", () => {
    const layers: ConfigLayer[] = [
      layer("/repo/.gtdrc", {
        vars: { z: { nope: true }, a: { nope: true } },
      }),
    ]
    const result = compileWorkflow(layers, noFiles)
    const paths = result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => d.path.join("."))
    expect(paths).toEqual(["vars.a", "vars.z"])
  })
})

describe("compileWorkflow — origin follows the finding's own layer, not the innermost layer touching the same top-level key", () => {
  it("attributes a vars error to the layer that actually declared the bad entry, when another layer's vars: is fine", () => {
    const outer: ConfigLayer = layer("/home/.gtdrc", { vars: { bad: { nested: true } } })
    const inner: ConfigLayer = layer("/repo/.gtdrc", { vars: { fine: "x" } })

    const result = compileWorkflow([outer, inner], noFiles)
    const found = result.diagnostics.find(
      (d) => d.severity === "error" && d.path.join(".") === "vars.bad",
    )
    expect(found?.origin).toBe("/home/.gtdrc")
  })

  it("attributes a workflow finding to the layer that declared the broken part, when another layer also touches workflow: (a different key)", () => {
    const outer: ConfigLayer = layer("/home/.gtdrc", {
      workflow: {
        entry: { default: "root" },
        machines: { root: { entry: "a", states: { a: validState({ "* **": "nowhere" }) } } },
      },
    })
    // Also declares `workflow:`, but only adds `vars:` — never touches
    // `machines` at all — so the merged `workflow.machines` subtree is
    // entirely the OUTER layer's, and every finding inside it must still
    // name `/home/.gtdrc`, not `/repo/.gtdrc`.
    const inner: ConfigLayer = layer("/repo/.gtdrc", {
      workflow: { vars: { greeting: "hi" } },
    })

    const result = compileWorkflow([outer, inner], noFiles)
    const found = result.diagnostics.filter(
      (d) => d.severity === "error" && d.path.join(".").startsWith("workflow.machines."),
    )
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((d) => d.origin === "/home/.gtdrc")).toBe(true)
  })

  it("attributes a finding about a key NEITHER layer declared to the innermost layer that touched the enclosing subtree, never BUILT_IN_ORIGIN", () => {
    // Neither layer declares `entry:` at all — the `workflow.entry.default`
    // path exists nowhere in either layer's own raw value, only in the
    // MERGED result. The finding is 100% about the user's own (misconfigured)
    // workflow, so it must never fall back to `(built-in default)`.
    const outer: ConfigLayer = layer("/home/.gtdrc", {
      workflow: {
        machines: { root: { entry: "a", states: { a: validState() } } },
      },
    })
    const inner: ConfigLayer = layer("/repo/.gtdrc", {
      workflow: { vars: { g: "hi" } },
    })

    const result = compileWorkflow([outer, inner], noFiles)
    const found = result.diagnostics.find(
      (d) => d.severity === "error" && d.path.join(".") === "workflow.entry.default",
    )
    expect(found?.message).toMatch(/"entry\.default" must name a machine/)
    // Neither layer touched `entry` specifically — falls back to whichever
    // layer most recently touched the ENCLOSING `workflow` subtree, `/repo`.
    expect(found?.origin).toBe("/repo/.gtdrc")
    expect(found?.origin).not.toBe("(built-in default)")
  })
})

describe("compileWorkflow — dedup by (severity, path, message, origin), first occurrence wins", () => {
  it("keeps both layers' findings when two layers independently reference the same missing file", () => {
    // Each layer's own `workflow.summary` file reference is resolved against
    // its OWN layer, before merging (`inlineWorkflowFileRefs`, per layer) —
    // so two layers naming the same missing file produce the SAME
    // (severity, path, message) triple twice, once per layer. `origin`
    // differs, so both survive, in layer order — a nearer layer repeating an
    // outer layer's mistake does not silence the outer layer's line.
    const outer: ConfigLayer = layer("/home/.gtdrc", { workflow: { summary: "./missing.md" } })
    const inner: ConfigLayer = layer("/repo/.gtdrc", { workflow: { summary: "./missing.md" } })

    const result = compileWorkflow([outer, inner], noFiles)
    const matching = result.diagnostics.filter((d) => d.path.join(".") === "summary")
    expect(matching).toHaveLength(2)
    expect(matching.map((d) => d.origin)).toEqual(["/home/.gtdrc", "/repo/.gtdrc"])
  })
})

describe("compileWorkflow — layering", () => {
  it("merges an inner layer's workflow over an outer layer's, inner wins on overlap", () => {
    const outer: ConfigLayer = layer("/home/.gtdrc", {
      workflow: {
        entry: { default: "root" },
        machines: { root: { entry: "a", states: { a: validState({ "* **": "a" }) } } },
      },
    })
    const inner: ConfigLayer = layer("/repo/.gtdrc", {
      workflow: { machines: { root: { states: { a: { message: "overridden" } } } } },
    })

    const result = compileWorkflow([outer, inner], noFiles)
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(result.workflow.states["a"]?.message).toBe("overridden")
  })
})
