import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { flattenMachines, resolveGlobTokens, resolveVarTokens } from "./Machines.js"

const agentState = (on: Record<string, unknown>) => ({ actor: "agent", prompt: "p", on })
const checkState = (on: Record<string, unknown>) => ({ actor: "check", script: "s", on })
const commitState = (msg = "chore: done") => ({ commit: msg })
const humanState = (on: Record<string, unknown>) => ({ actor: "human", message: "m", on })

describe("flattenMachines — flattening and qualification", () => {
  it("emits a single machine's states qualified at the root (empty path prefix)", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(Object.keys(out.states).sort()).toEqual(["done", "start"])
    expect(out.entries).toEqual({ default: "start" })
  })

  it("qualifies a referenced child machine's states under the reference's dot path", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(Object.keys(out.states).sort()).toEqual(["packages.check", "packages.finish"])
    // The on-target resolves within the CHILD's own namespace, qualified under its dot path.
    expect((out.states["packages.check"] as { on: unknown }).on).toEqual({ C: "packages.finish" })
  })
})

describe("flattenMachines — entry resolution", () => {
  it("resolves entry.default through the root machine's own entry field", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: { entry: "start", states: { start: agentState({ "* **": "start" }) } },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.entries).toEqual({ default: "start" })
  })

  it("ignores legacy entry.review/entry.fix raw keys entirely — entries is just {default}", () => {
    const out = flattenMachines({
      entry: { default: "unified", review: "review-gate", fix: "review-gate" },
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
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
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
    const out = flattenMachines(baseMachines({ "* **": "done" }))
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect((out.states["start"] as { on: unknown }).on).toEqual({ "* **": "done" })
  })

  it("resolves a local reference target with no remainder through the child's own entry", () => {
    const out = flattenMachines(baseMachines({ "* **": "child" }))
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect((out.states["start"] as { on: unknown }).on).toEqual({ "* **": "child.step" })
  })

  it("resolves a reference-with-remainder target by recursing into the child", () => {
    const out = flattenMachines(baseMachines({ "* **": "child.step" }))
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect((out.states["start"] as { on: unknown }).on).toEqual({ "* **": "child.step" })
  })

  it("refuses a sideways/upward target that names neither a local state nor a reference", () => {
    const out = flattenMachines({
      entry: { default: "specReview" },
      machines: {
        specReview: {
          entry: "fix",
          states: { fix: checkState({ C: "health.check" }) },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([
      'machines.specReview.fix: "on" target "health.check" is not a state or reference of machine "specReview" — declare a "params:" entry and bind it at the reference site',
    ])
  })

  it("refuses an upward target naming a state of the parent machine", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([
      'machines.childMachine.step: "on" target "done" is not a state or reference of machine "childMachine" — declare a "params:" entry and bind it at the reference site',
    ])
  })

  it("refuses a sideways target naming a sibling reference key plus its state", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([
      'machines.otherMachine.doer: "on" target "health.check" is not a state or reference of machine "otherMachine" — declare a "params:" entry and bind it at the reference site',
    ])
  })

  it("refuses a remainder used against a local state", () => {
    const out = flattenMachines({
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
    })
    expect(
      out.diagnostics.some((d) =>
        d.message.includes(
          '"on" target "done.extra" is not a state or reference of machine "unified"',
        ),
      ),
    ).toBe(true)
  })
})

describe("flattenMachines — binding scope", () => {
  it("resolves a param threaded through two levels of reference in the grandparent's own namespace", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    // "done" resolves against the GRANDPARENT's namespace (root, empty path prefix) —
    // not "mid.done" or "mid.inner.done".
    expect((out.states["mid.inner.step"] as { on: unknown }).on).toEqual({ "* **": "done" })
  })

  it("resolves a `routes:` row's `to` through a bound $param, leaving `question`/`is`/`minP` untouched", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "gate",
          states: {
            fix: commitState(),
            gate: { machine: "healthGate", with: { onRed: "fix" } },
          },
        },
        healthGate: {
          params: ["onRed"],
          entry: "judge",
          states: {
            escalate: commitState("chore: escalate"),
            judge: {
              actor: "human",
              message: "m",
              judge: "{}",
              routes: [{ question: "verdict", is: "identical", to: "escalate" }, { to: "$onRed" }],
            },
          },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect((out.states["gate.judge"] as { routes: unknown }).routes).toEqual([
      { question: "verdict", is: "identical", to: "gate.escalate" },
      { to: "fix" },
    ])
  })
})

describe("flattenMachines — Pass 1 guards", () => {
  it("reports a machine reference cycle and skips the offending subtree", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toContain(
      "machine reference cycle: unified → packages → unified",
    )
  })

  it("reports an unknown machine referenced by a local and skips it", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machines.packageLoop.health: unknown machine "makeGrene"',
    )
  })

  it("reports a dotted local name and skips only that local", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machine "unified": local name "a.b" must not contain "."',
    )
    expect(Object.keys(out.states).sort()).toEqual(["start"])
  })

  it("reports an unreferenced machine after both passes", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: { entry: "start", states: { start: agentState({ "* **": "start" }) } },
        oldLoop: { entry: "x", states: { x: agentState({ "* **": "x" }) } },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machine "oldLoop" is declared but never referenced',
    )
  })
})

describe("flattenMachines — model stamping", () => {
  it("stamps a directly-declared machine model onto every prompt-content state, and never onto non-prompt states", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          model: "opus",
          entry: "start",
          states: {
            start: agentState({ "* **": "check" }),
            check: checkState({ C: "gate" }),
            gate: humanState({ "* **": "done" }),
            done: commitState(),
          },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect((out.states["start"] as { model: unknown }).model).toBe("opus")
    expect(out.states["check"]).not.toHaveProperty("model")
    expect(out.states["gate"]).not.toHaveProperty("model")
    expect(out.states["done"]).not.toHaveProperty("model")
  })

  it("resolves a machine model declared as a whole-value $param through the reference site's binding", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "child",
          states: {
            child: { machine: "childMachine", with: { model: "some-value" } },
          },
        },
        childMachine: {
          model: "$model",
          params: ["model"],
          entry: "step",
          states: {
            step: agentState({ "* **": "step" }),
          },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect((out.states["child.step"] as { model: unknown }).model).toBe("some-value")
  })

  it("stamps nothing when a whole-value $model param resolves to the empty string", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "child",
          states: {
            child: { machine: "childMachine", with: { model: "" } },
          },
        },
        childMachine: {
          model: "$model",
          params: ["model"],
          entry: "step",
          states: {
            step: agentState({ "* **": "step" }),
          },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.states["child.step"]).not.toHaveProperty("model")
  })

  it("stamps nothing when a machine declares no model", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: { entry: "start", states: { start: agentState({ "* **": "start" }) } },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.states["start"]).not.toHaveProperty("model")
  })
})

describe("flattenMachines — system stamping", () => {
  it("stamps a directly-declared machine system prompt onto every prompt-content state, and never onto non-prompt states", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          system: "You are a careful agent.",
          entry: "start",
          states: {
            start: agentState({ "* **": "check" }),
            check: checkState({ C: "gate" }),
            gate: humanState({ "* **": "done" }),
            done: commitState(),
          },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect((out.states["start"] as { system: unknown }).system).toBe("You are a careful agent.")
    expect(out.states["check"]).not.toHaveProperty("system")
    expect(out.states["gate"]).not.toHaveProperty("system")
    expect(out.states["done"]).not.toHaveProperty("system")
  })

  it("resolves a machine system prompt declared as a whole-value $param through the reference site's binding", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "child",
          states: {
            child: { machine: "childMachine", with: { system: "some-persona" } },
          },
        },
        childMachine: {
          system: "$system",
          params: ["system"],
          entry: "step",
          states: {
            step: agentState({ "* **": "step" }),
          },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect((out.states["child.step"] as { system: unknown }).system).toBe("some-persona")
  })

  it("stamps nothing when a whole-value $system param resolves to the empty string", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "child",
          states: {
            child: { machine: "childMachine", with: { system: "" } },
          },
        },
        childMachine: {
          system: "$system",
          params: ["system"],
          entry: "step",
          states: {
            step: agentState({ "* **": "step" }),
          },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.states["child.step"]).not.toHaveProperty("system")
  })

  it("stamps nothing when a machine declares no system", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: { entry: "start", states: { start: agentState({ "* **": "start" }) } },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.states["start"]).not.toHaveProperty("system")
  })

  it("does not leak a machine's system prompt into a reference local's child-machine states", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          system: "parent-persona",
          entry: "child",
          states: {
            child: { machine: "childMachine" },
          },
        },
        childMachine: {
          entry: "step",
          states: { step: agentState({ "* **": "step" }) },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.states["child.step"]).not.toHaveProperty("system")
  })

  it("stamps `model` and `system` together, both independently", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          model: "opus",
          system: "a persona",
          entry: "start",
          states: { start: agentState({ "* **": "start" }) },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.states["start"]).toMatchObject({ model: "opus", system: "a persona" })
  })
})

describe("flattenMachines — scopes", () => {
  it("covers every emitted state (prompt, script, human-gate, and commit alike) with its owning instance path", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "start",
          states: {
            start: agentState({ "* **": "packages" }),
            packages: { machine: "packageLoop" },
          },
        },
        packageLoop: {
          entry: "check",
          states: {
            check: checkState({ C: "gate" }),
            gate: humanState({ "* **": "finish" }),
            finish: commitState(),
          },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(Object.keys(out.scopes).sort()).toEqual(Object.keys(out.states).sort())
    expect(out.scopes["start"]).toBe("")
    expect(out.scopes["packages.check"]).toBe("packages")
    expect(out.scopes["packages.gate"]).toBe("packages")
    expect(out.scopes["packages.finish"]).toBe("packages")
  })

  it("gives two distinct references to the same machine two distinct scopes entries", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "first",
          states: {
            first: { machine: "worker" },
            second: { machine: "worker" },
          },
        },
        worker: {
          entry: "step",
          states: { step: agentState({ "* **": "step" }) },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.scopes["first.step"]).toBe("first")
    expect(out.scopes["second.step"]).toBe("second")
    expect(out.scopes["first.step"]).not.toBe(out.scopes["second.step"])
  })
})

describe("flattenMachines — unbound param through a chained reference entry", () => {
  it("reports an unbound param encountered while resolving a reference's own entry, breadcrumbed to the reference", () => {
    const out = flattenMachines({
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
    })
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machines.unified.build (makeGreen): references unbound param "$onGreen"',
    )
  })
})

describe("flattenMachines — a reference's `each:` (.gtd/packages/01-each-declaration.md)", () => {
  const withEach = (
    each: Record<string, unknown>,
    packageItemEntry: string | null = "building",
  ) => ({
    entry: { default: "unified" },
    machines: {
      unified: {
        entry: "start",
        states: {
          start: agentState({ "* **": "loop" }),
          loop: { machine: "packageItem", each },
          finish: commitState(),
        },
      },
      packageItem: {
        ...(packageItemEntry !== null ? { entry: packageItemEntry } : {}),
        states: { building: checkState({ C: "building" }) },
      },
    },
  })

  it("instantiates the referenced machine exactly once, at its ordinary base path — no per-item instantiation", () => {
    const out = flattenMachines(withEach({ glob: ".gtd/packages/*.md", drained: "finish" }))
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(Object.keys(out.states).sort()).toEqual(["finish", "loop.building", "start"])
  })

  it("records the source and resolves `drained:` against the REFERRING instance, on the instantiated node", () => {
    const out = flattenMachines(withEach({ glob: ".gtd/packages/*.md", drained: "finish" }))
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.instances.get("loop")?.each).toEqual({
      source: { kind: "glob", value: ".gtd/packages/*.md" },
      drained: "finish",
      entry: "loop.building",
    })
  })

  it("resolves a `var:` source the same way", () => {
    const out = flattenMachines(withEach({ var: "a, b", drained: "finish" }))
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.instances.get("loop")?.each?.source).toEqual({ kind: "var", value: "a, b" })
  })

  it("an unresolvable `drained:` is a fatal diagnostic whose path points at the reference site", () => {
    const out = flattenMachines(withEach({ glob: ".gtd/packages/*.md", drained: "nowhere" }))
    const found = out.diagnostics.find((d) => d.message.includes('"nowhere"'))
    expect(found).toBeDefined()
    expect(found!.path).toEqual(["machines", "unified", "states", "loop"])
    expect(out.instances.get("loop")?.each).toBeUndefined()
  })

  it("declaring neither `glob:` nor `var:` is a fatal diagnostic", () => {
    const out = flattenMachines(withEach({ drained: "finish" }))
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machines.unified.loop.each: declare exactly one of "glob" or "var"',
    )
  })

  it("declaring BOTH `glob:` and `var:` is a fatal diagnostic", () => {
    const out = flattenMachines(withEach({ glob: "*.md", var: "a,b", drained: "finish" }))
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machines.unified.loop.each: declare exactly one of "glob" or "var"',
    )
  })

  it("a missing `drained:` is a fatal diagnostic", () => {
    const out = flattenMachines(withEach({ glob: "*.md" }))
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machines.unified.loop.each: "drained" is required',
    )
  })

  it("`each:` on a reference whose machine declares no `entry:` is a fatal diagnostic", () => {
    const out = flattenMachines(withEach({ glob: "*.md", drained: "finish" }, null))
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machines.unified.loop.each: machine "packageItem" declares no "entry:" for the loop to enter',
    )
  })

  it("an unknown key inside `each:` is a fatal diagnostic", () => {
    const out = flattenMachines(
      withEach({ glob: "*.md", drained: "finish", bogus: true } as Record<string, unknown>),
    )
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machines.unified.loop.each: unknown key "bogus"',
    )
  })

  it("a reference WITHOUT `each:` is unaffected — no `each` recorded", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "loop",
          states: { loop: { machine: "packageItem" } },
        },
        packageItem: { entry: "building", states: { building: checkState({ C: "building" }) } },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toEqual([])
    expect(out.instances.get("loop")?.each).toBeUndefined()
  })

  // Round-2 review finding: `qualifierIndexAt`/`qualifyAt` anchor on a BASE
  // (unqualified) ref path, so a reference's own `each:` sitting inside
  // ANOTHER `each:` reference's subtree silently mis-derives the inner
  // loop's position (it never advances past item 0). Rather than teach every
  // qualifier helper to tolerate an already-qualified ancestor segment, a
  // nested `each:` is rejected here, at load time, so the silently-wrong
  // runtime case can't be authored at all.
  it("a nested `each:` — a reference's own `each:` sitting inside another each: reference's subtree — is a fatal diagnostic", () => {
    const out = flattenMachines({
      entry: { default: "unified" },
      machines: {
        unified: {
          entry: "start",
          states: {
            start: agentState({ "* **": "loop" }),
            loop: { machine: "packageItem", each: { glob: "*.md", drained: "finish" } },
            finish: commitState(),
          },
        },
        packageItem: {
          entry: "sub",
          states: {
            sub: { machine: "innerItem", each: { glob: "*.md", drained: "done" } },
            done: commitState(),
          },
        },
        innerItem: {
          entry: "building",
          states: { building: checkState({ C: "building" }) },
        },
      },
    })
    expect(out.diagnostics.map((d) => d.message)).toContain(
      'machines.packageItem.sub.each: nested inside each: reference "loop" — a nested each: is not supported',
    )
  })
})

describe("resolveVarTokens — .gtd/packages/01-each-declaration.md Task 2", () => {
  it("splits, trims, and drops empty fields", () => {
    expect(resolveVarTokens("a, b ,c")).toEqual(["a", "b", "c"])
  })

  it("drops empty fields from a run of commas — does not preserve them", () => {
    expect(resolveVarTokens("a,,b")).toEqual(["a", "b"])
  })

  it("resolves an empty or whitespace-only var to an empty list, not an error", () => {
    expect(resolveVarTokens("")).toEqual([])
    expect(resolveVarTokens("   ")).toEqual([])
  })

  it("resolves a var containing $(...) to the literal token — no subshell runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-each-var-"))
    const marker = join(dir, "ran")
    const token = `$(touch ${marker})`
    try {
      expect(resolveVarTokens(token)).toEqual([token])
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("resolves a var containing a backtick to a literal token", () => {
    const token = "`echo hi`"
    expect(resolveVarTokens(token)).toEqual([token])
  })
})

describe("resolveGlobTokens — .gtd/packages/01-each-declaration.md Task 3", () => {
  it("delegates to the injected workspace's own glob, unchanged", () => {
    const calls: string[] = []
    const workspace = { glob: (pattern: string) => (calls.push(pattern), ["b.md", "a.md"]) }
    const result = resolveGlobTokens(workspace)(".gtd/packages/*.md")
    expect(calls).toEqual([".gtd/packages/*.md"])
    expect(result).toEqual(["b.md", "a.md"])
  })
})
