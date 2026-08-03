import { describe, expect, it } from "vitest"
import { compileWorkflowConfig } from "./PatternConfig.js"
import { expandSubmachines } from "./Submachines.js"

// ── Equivalence: a two-instance dedup sub-machine expands to the flat form ────

describe("expandSubmachines — dedup equivalence", () => {
  // A minimal assertGreen-shaped gate, authored once and invoked twice.
  const submachineForm = {
    submachines: {
      assertGreen: {
        params: ["onGreen", "blockedMsg", "blockedDesc"],
        states: {
          check: {
            actor: "check",
            script: "run the suite",
            on: { "A .gtd/FEEDBACK.md": "blocked", C: "$onGreen" },
          },
          blocked: {
            actor: "human",
            message: "$blockedMsg",
            file: ".gtd/FEEDBACK.md",
            on: { "* **": { to: "check", describe: "$blockedDesc" } },
          },
        },
      },
    },
    use: [
      {
        submachine: "assertGreen",
        as: { check: "start-check", blocked: "start-blocked" },
        with: {
          onGreen: "planning",
          blockedMsg: "red: fix before starting",
          blockedDesc: "re-run (start-check)",
        },
      },
      {
        submachine: "assertGreen",
        as: { check: "rev-check", blocked: "rev-blocked" },
        with: {
          onGreen: "reviewing",
          blockedMsg: "red: fix before review",
          blockedDesc: "re-run (rev-check)",
        },
      },
    ],
    states: {
      idle: {
        actor: "human",
        message: "idle",
        initial: true,
        on: { "* review": "rev-check", "* **": "start-check" },
      },
      planning: { actor: "agent", prompt: "plan", on: { "* **": "done" } },
      reviewing: { actor: "agent", prompt: "review", on: { "* **": "done" } },
      done: { commit: "chore: done" },
    },
  }

  // The hand-written flat workflow the sub-machine form must compile identically to.
  const flatForm = {
    states: {
      idle: {
        actor: "human",
        message: "idle",
        initial: true,
        on: { "* review": "rev-check", "* **": "start-check" },
      },
      "start-check": {
        actor: "check",
        script: "run the suite",
        on: { "A .gtd/FEEDBACK.md": "start-blocked", C: "planning" },
      },
      "start-blocked": {
        actor: "human",
        message: "red: fix before starting",
        file: ".gtd/FEEDBACK.md",
        on: { "* **": { to: "start-check", describe: "re-run (start-check)" } },
      },
      "rev-check": {
        actor: "check",
        script: "run the suite",
        on: { "A .gtd/FEEDBACK.md": "rev-blocked", C: "reviewing" },
      },
      "rev-blocked": {
        actor: "human",
        message: "red: fix before review",
        file: ".gtd/FEEDBACK.md",
        on: { "* **": { to: "rev-check", describe: "re-run (rev-check)" } },
      },
      planning: { actor: "agent", prompt: "plan", on: { "* **": "done" } },
      reviewing: { actor: "agent", prompt: "review", on: { "* **": "done" } },
      done: { commit: "chore: done" },
    },
  }

  it("compiles byte-identically to the flat definition", () => {
    const sm = compileWorkflowConfig(submachineForm, "/dir")
    const flat = compileWorkflowConfig(flatForm, "/dir")
    expect(sm.definition).toEqual(flat.definition)
  })

  it("strips submachines/use and merges expanded states (no leftover top-level keys)", () => {
    const errors: string[] = []
    const out = expandSubmachines(submachineForm, errors) as Record<string, unknown>
    expect(errors).toEqual([])
    expect(out).not.toHaveProperty("submachines")
    expect(out).not.toHaveProperty("use")
    const states = out["states"] as Record<string, unknown>
    expect(Object.keys(states).sort()).toEqual(
      [
        "done",
        "idle",
        "planning",
        "rev-blocked",
        "rev-check",
        "reviewing",
        "start-blocked",
        "start-check",
      ].sort(),
    )
  })
})

// ── `as` identity default + `set` per-instance overrides ─────────────────────

describe("expandSubmachines — as default and set overrides", () => {
  it("omitted `as` uses local names verbatim; `set` merges extra fields", () => {
    const errors: string[] = []
    const out = expandSubmachines(
      {
        submachines: {
          gate: {
            params: ["onGreen"],
            states: { check: { actor: "check", script: "s", on: { C: "$onGreen" } } },
          },
        },
        use: [
          { submachine: "gate", with: { onGreen: "next" }, set: { check: { reviewEntry: true } } },
        ],
        states: {
          next: { actor: "agent", prompt: "p", on: { "* **": "check" } },
        },
      },
      errors,
    ) as { states: Record<string, Record<string, unknown>> }
    expect(errors).toEqual([])
    expect(out.states["check"]).toEqual({
      actor: "check",
      script: "s",
      on: { C: "next" },
      reviewEntry: true,
    })
  })
})

// ── Passthrough + error findings ─────────────────────────────────────────────

describe("expandSubmachines — passthrough and errors", () => {
  it("returns the raw unchanged when neither submachines nor use is present", () => {
    const raw = { states: { a: { commit: "x" } } }
    expect(expandSubmachines(raw, [])).toBe(raw)
  })

  it("does not touch bash `$var`/`${var}` or Eta tags inside content (whole-value only)", () => {
    const errors: string[] = []
    const out = expandSubmachines(
      {
        submachines: {
          sm: {
            params: ["onGreen"],
            states: {
              check: {
                actor: "check",
                script: 'x="<%~ it.vars.f %>"\necho "$x ${y}"',
                on: { C: "$onGreen" },
              },
            },
          },
        },
        use: [{ submachine: "sm", as: { check: "c" }, with: { onGreen: "done" } }],
        states: { done: { commit: "d" } },
      },
      errors,
    ) as { states: Record<string, Record<string, unknown>> }
    expect(errors).toEqual([])
    expect(out.states["c"]!.script).toBe('x="<%~ it.vars.f %>"\necho "$x ${y}"')
  })

  it("reports an unknown sub-machine", () => {
    const errors: string[] = []
    expandSubmachines(
      { use: [{ submachine: "ghost", as: { check: "a" } }], states: { a: { commit: "x" } } },
      errors,
    )
    expect(errors.some((e) => e.includes('unknown sub-machine "ghost"'))).toBe(true)
  })

  it("reports a state-name collision with an existing state", () => {
    const errors: string[] = []
    expandSubmachines(
      {
        submachines: {
          sm: {
            params: [],
            states: { check: { actor: "check", script: "s", on: { C: "existing" } } },
          },
        },
        use: [{ submachine: "sm", as: { check: "existing" } }],
        states: { existing: { actor: "agent", prompt: "p", on: { "* **": "existing" } } },
      },
      errors,
    )
    expect(errors.some((e) => e.includes("collides with an existing state"))).toBe(true)
  })

  it("reports a target referencing an unbound param", () => {
    const errors: string[] = []
    expandSubmachines(
      {
        submachines: {
          sm: {
            params: ["onGreen"],
            states: {
              check: { actor: "check", script: "s", on: { C: "$onGreen", "* **": "$missing" } },
            },
          },
        },
        use: [{ submachine: "sm", as: { check: "c" }, with: { onGreen: "done" } }],
        states: { done: { commit: "d" } },
      },
      errors,
    )
    expect(errors.some((e) => e.includes('unbound param "$missing"'))).toBe(true)
  })
})

// ── `action` field survives expansion (parity with `describe`) ──────────────

describe("expandSubmachines — action field", () => {
  it("a literal `action` string on an on-entry survives expansion unchanged", () => {
    const errors: string[] = []
    const out = expandSubmachines(
      {
        submachines: {
          gate: {
            params: ["onGreen"],
            states: {
              check: {
                actor: "check",
                script: "s",
                on: { C: { to: "$onGreen", action: "Accept plan" } },
              },
            },
          },
        },
        use: [{ submachine: "gate", as: { check: "c" }, with: { onGreen: "next" } }],
        states: { next: { actor: "agent", prompt: "p", on: { "* **": "c" } } },
      },
      errors,
    ) as { states: Record<string, Record<string, unknown>> }
    expect(errors).toEqual([])
    expect(out.states["c"]!.on).toEqual({ C: { to: "next", action: "Accept plan" } })
  })

  it("`action: $param` is substituted like `describe: $param`", () => {
    const errors: string[] = []
    const out = expandSubmachines(
      {
        submachines: {
          gate: {
            params: ["onGreen", "actionLabel"],
            states: {
              check: {
                actor: "check",
                script: "s",
                on: { C: { to: "$onGreen", action: "$actionLabel" } },
              },
            },
          },
        },
        use: [
          {
            submachine: "gate",
            as: { check: "c" },
            with: { onGreen: "next", actionLabel: "Accept plan" },
          },
        ],
        states: { next: { actor: "agent", prompt: "p", on: { "* **": "c" } } },
      },
      errors,
    ) as { states: Record<string, Record<string, unknown>> }
    expect(errors).toEqual([])
    expect(out.states["c"]!.on).toEqual({ C: { to: "next", action: "Accept plan" } })
  })
})
