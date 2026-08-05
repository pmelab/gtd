import { describe, expect, it } from "vitest"
import { flattenMachines } from "./Machines.js"

// A minimal state shared by scenarios that don't care about content.
const agentState = (on: Record<string, unknown>) => ({ actor: "agent", prompt: "p", on })
const checkState = (on: Record<string, unknown>) => ({ actor: "check", script: "s", on })
const commitState = (msg = "chore: done") => ({ commit: msg })

describe("flattenMachines — flattening and qualification", () => {
  it("emits a single machine's states qualified at the root (empty path prefix)", () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "done" }),
              done: commitState(),
            },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([])
    expect(Object.keys(out.states).sort()).toEqual(["done", "start"])
    expect(out.entries).toEqual({ default: "start" })
  })

  it("qualifies a referenced child machine's states under the reference's dot path", () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: {
            entry: "packages",
            states: {
              packages: { machine: "packageLoop" },
            },
          },
          packageLoop: {
            entry: "check",
            states: {
              check: checkState({ C: "finish" }),
              finish: commitState(),
            },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([])
    expect(Object.keys(out.states).sort()).toEqual(["packages.check", "packages.finish"])
    // The on-target resolves within the CHILD's own namespace, qualified under its dot path.
    expect((out.states["packages.check"] as { on: unknown }).on).toEqual({ C: "packages.finish" })
  })
})

describe("flattenMachines — entry resolution", () => {
  it("resolves entry.default through the root machine's own entry field", () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: { entry: "start", states: { start: agentState({ "* **": "start" }) } },
        },
      },
      errors,
    )
    expect(errors).toEqual([])
    expect(out.entries).toEqual({ default: "start" })
  })

  it("resolves a bare reference-key entry.review to the referenced machine's own entry", () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "unified", review: "review-gate" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "start" }),
              "review-gate": { machine: "reviewMachine" },
            },
          },
          reviewMachine: {
            entry: "check",
            states: { check: checkState({ C: "check" }) },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([])
    expect(out.entries).toEqual({ default: "start", review: "review-gate.check" })
  })

  it("resolves entry.fix transitively through a chain of reference keys", () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "unified", fix: "outer" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "start" }),
              outer: { machine: "middle" },
            },
          },
          middle: {
            entry: "inner",
            states: { inner: { machine: "innermost" } },
          },
          innermost: {
            entry: "fixup",
            states: { fixup: checkState({ C: "fixup" }) },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([])
    expect(out.entries).toEqual({ default: "start", fix: "outer.inner.fixup" })
  })

  it("resolves entry.review naming a state path through a reference", () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "unified", review: "review-gate.check" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "start" }),
              "review-gate": { machine: "reviewMachine" },
            },
          },
          reviewMachine: {
            entry: "check",
            states: { check: checkState({ C: "check" }) },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([])
    expect(out.entries).toEqual({ default: "start", review: "review-gate.check" })
  })

  it('reports "entry.review" naming an unresolvable path', () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "unified", review: "review-gate.chek" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "start" }),
              "review-gate": { machine: "reviewMachine" },
            },
          },
          reviewMachine: {
            entry: "check",
            states: { check: checkState({ C: "check" }) },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([
      `"entry.review" names "review-gate.chek", which is not a state or machine reference`,
    ])
    expect(out.entries).toEqual({ default: "start" })
  })
})

describe("flattenMachines — resolver cases", () => {
  const baseMachines = (extraOn: Record<string, unknown>) => ({
    entry: { default: "unified" },
    machines: {
      unified: {
        entry: "start",
        states: {
          start: agentState(extraOn),
          done: commitState(),
          child: { machine: "childMachine" },
        },
      },
      childMachine: {
        entry: "step",
        states: { step: checkState({ C: "step" }) },
      },
    },
  })

  it("resolves a local state target with no remainder", () => {
    const errors: string[] = []
    const out = flattenMachines(baseMachines({ "* **": "done" }), errors)
    expect(errors).toEqual([])
    expect((out.states["start"] as { on: unknown }).on).toEqual({ "* **": "done" })
  })

  it("resolves a local reference target with no remainder through the child's own entry", () => {
    const errors: string[] = []
    const out = flattenMachines(baseMachines({ "* **": "child" }), errors)
    expect(errors).toEqual([])
    expect((out.states["start"] as { on: unknown }).on).toEqual({ "* **": "child.step" })
  })

  it("resolves a reference-with-remainder target by recursing into the child", () => {
    const errors: string[] = []
    const out = flattenMachines(baseMachines({ "* **": "child.step" }), errors)
    expect(errors).toEqual([])
    expect((out.states["start"] as { on: unknown }).on).toEqual({ "* **": "child.step" })
  })

  it("refuses a sideways/upward target that names neither a local state nor a reference", () => {
    const errors: string[] = []
    flattenMachines(
      {
        entry: { default: "specReview" },
        machines: {
          specReview: {
            entry: "fix",
            states: { fix: checkState({ C: "health.check" }) },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([
      'machines.specReview.fix: "on" target "health.check" is not a state or reference of machine "specReview" — declare a "params:" entry and bind it at the reference site',
    ])
  })

  it("refuses an upward target naming a state of the parent machine", () => {
    const errors: string[] = []
    flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "start" }),
              done: commitState(),
              child: { machine: "childMachine" },
            },
          },
          childMachine: {
            entry: "step",
            states: { step: checkState({ C: "done" }) },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([
      'machines.childMachine.step: "on" target "done" is not a state or reference of machine "childMachine" — declare a "params:" entry and bind it at the reference site',
    ])
  })

  it("refuses a sideways target naming a sibling reference key plus its state", () => {
    const errors: string[] = []
    flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "start" }),
              health: { machine: "healthMachine" },
              other: { machine: "otherMachine" },
            },
          },
          healthMachine: {
            entry: "check",
            states: { check: checkState({ C: "check" }) },
          },
          otherMachine: {
            entry: "doer",
            states: { doer: checkState({ C: "health.check" }) },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([
      'machines.otherMachine.doer: "on" target "health.check" is not a state or reference of machine "otherMachine" — declare a "params:" entry and bind it at the reference site',
    ])
  })

  it("refuses a remainder used against a local state", () => {
    const errors: string[] = []
    flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "done.extra" }),
              done: commitState(),
            },
          },
        },
      },
      errors,
    )
    expect(
      errors.some((e) =>
        e.includes('"on" target "done.extra" is not a state or reference of machine "unified"'),
      ),
    ).toBe(true)
  })
})

describe("flattenMachines — binding scope", () => {
  it("resolves a param threaded through two levels of reference in the grandparent's own namespace", () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "grandparent" },
        machines: {
          grandparent: {
            entry: "mid",
            states: {
              done: commitState(),
              mid: { machine: "parent", with: { onDone: "done" } },
            },
          },
          parent: {
            params: ["onDone"],
            entry: "inner",
            states: {
              inner: { machine: "child", with: { onDone: "$onDone" } },
            },
          },
          child: {
            params: ["onDone"],
            entry: "step",
            states: {
              step: agentState({ "* **": "$onDone" }),
            },
          },
        },
      },
      errors,
    )
    expect(errors).toEqual([])
    // "done" resolves against the GRANDPARENT's namespace (root, empty path prefix) —
    // not "mid.done" or "mid.inner.done".
    expect((out.states["mid.inner.step"] as { on: unknown }).on).toEqual({ "* **": "done" })
  })
})

describe("flattenMachines — Pass 1 guards", () => {
  it("reports a machine reference cycle and skips the offending subtree", () => {
    const errors: string[] = []
    flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: {
            entry: "packages",
            states: { packages: { machine: "packages" } },
          },
          packages: {
            entry: "back",
            states: { back: { machine: "unified" } },
          },
        },
      },
      errors,
    )
    expect(errors).toContain("machine reference cycle: unified → packages → unified")
  })

  it("reports an unknown machine referenced by a local and skips it", () => {
    const errors: string[] = []
    flattenMachines(
      {
        entry: { default: "packageLoop" },
        machines: {
          packageLoop: {
            entry: "x",
            states: {
              x: agentState({ "* **": "x" }),
              health: { machine: "makeGrene" },
            },
          },
        },
      },
      errors,
    )
    expect(errors).toContain('machines.packageLoop.health: unknown machine "makeGrene"')
  })

  it("reports a dotted local name and skips only that local", () => {
    const errors: string[] = []
    const out = flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: {
            entry: "start",
            states: {
              start: agentState({ "* **": "start" }),
              "a.b": commitState(),
            },
          },
        },
      },
      errors,
    )
    expect(errors).toContain('machine "unified": local name "a.b" must not contain "."')
    expect(Object.keys(out.states).sort()).toEqual(["start"])
  })

  it("reports an unreferenced machine after both passes", () => {
    const errors: string[] = []
    flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: { entry: "start", states: { start: agentState({ "* **": "start" }) } },
          oldLoop: { entry: "x", states: { x: agentState({ "* **": "x" }) } },
        },
      },
      errors,
    )
    expect(errors).toContain('machine "oldLoop" is declared but never referenced')
  })
})

describe("flattenMachines — unbound param through a chained reference entry", () => {
  it("reports an unbound param encountered while resolving a reference's own entry, breadcrumbed to the reference", () => {
    const errors: string[] = []
    flattenMachines(
      {
        entry: { default: "unified" },
        machines: {
          unified: {
            entry: "build",
            states: {
              build: agentState({ C: "makeGreen" }),
              makeGreen: { machine: "greenMachine" },
            },
          },
          greenMachine: {
            params: ["onGreen"],
            entry: "$onGreen",
            states: { anything: commitState() },
          },
        },
      },
      errors,
    )
    expect(errors).toContain(
      'machines.unified.build (makeGreen): references unbound param "$onGreen"',
    )
  })
})
