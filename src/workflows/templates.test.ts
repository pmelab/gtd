import { parse as parseYaml } from "yaml"
import { describe, expect, it } from "vitest"
import { validateDefinition } from "../PatternMachine.js"
import type { MachineNode } from "../Machines.js"
import {
  compileTemplate,
  defaultStateScopes,
  defaultWorkflowDefinition,
  defaultWorkflowVars,
  INIT_VARS,
  MODES_SUGGESTION,
  renderInitConfig,
  renderInitScaffold,
  SCHEMA_URL,
} from "./templates.js"
import unifiedYaml from "./unified.yaml"

describe("the bundled unified workflow template", () => {
  it("compiles with no validation findings and exactly one initial state", () => {
    const { definition } = compileTemplate()
    expect(validateDefinition(definition)).toEqual([])
    expect(definition.entries.default).toBeTruthy()
    expect(definition.states[definition.entries.default]).toBeDefined()
  })

  it("declares exactly one review checkout window and one review entry", () => {
    // The cycle runs to a human review gate, so it must declare exactly one
    // `reviewWindow: true` state (the gate that opens the editor's checkout
    // window) and exactly one manual entry named `review-gate.check` (the
    // `gtd --entry review-gate.check` entry point) — see src/ReviewWindow.ts.
    const { definition } = compileTemplate()
    const states = Object.values(definition.states)
    expect(states.filter((s) => s.reviewWindow === true)).toHaveLength(1)
    expect(definition.entries.manual).toContain("review-gate.check")
  })

  it("declares exactly one review-base state anchoring the incremental review window", () => {
    const { definition } = compileTemplate()
    const states = Object.values(definition.states)
    expect(states.filter((s) => s.reviewBase === true)).toHaveLength(1)
  })

  it("no compiled state's content mentions a deleted diff variable — prompts carry ranges, never diff content", () => {
    const { definition } = compileTemplate()
    const forbidden = /processDiff|reviewDiff|retainedDiff|lastDiff/
    for (const [name, state] of Object.entries(definition.states)) {
      for (const content of [state.script, state.prompt, state.message, state.commit]) {
        if (content !== undefined) expect(content, `state "${name}"`).not.toMatch(forbidden)
      }
    }
  })

  it("forks the initial state on the two entry files, each into its green-baseline gate", () => {
    // idle routes `.gtd/REQUIREMENTS.md` to the advanced flow's start gate and
    // everything else (e.g. `.gtd/TODO.md`) to the simple flow's start gate —
    // the REQUIREMENTS row is declared first so it wins. Each gate runs the
    // suite before proceeding to planning/product Q&A.
    const { definition } = compileTemplate()
    const idle = definition.states.idle!
    const targets = (idle.on ?? []).map(([, to]) => to)
    expect(targets).toContain("spec-gate.check")
    expect(targets).toContain("plan-gate.check")
    // The gates proceed to the planning states once green.
    expect((definition.states["plan-gate.check"]!.on ?? []).map(([, to]) => to)).toContain(
      "plan.planning",
    )
    expect((definition.states["spec-gate.check"]!.on ?? []).map(([, to]) => to)).toContain(
      "product.author",
    )
  })

  it("declares exactly the four qualified entryGate/fix-precheck states as manual entries", () => {
    // All three `entryGate` instances (plan-gate/spec-gate/review-gate)
    // declare `entry: true` on their shared `check` local — the dedup means
    // marking one marks all three, even though only `review-gate.check`
    // actually needs the reachability root — plus `fix-precheck`'s own.
    const { definition } = compileTemplate()
    const { default: def, manual } = definition.entries
    expect(def).toBeTruthy()
    expect(manual).toEqual([
      "fix-precheck",
      "plan-gate.check",
      "review-gate.check",
      "spec-gate.check",
    ])
    expect(new Set([def, ...manual]).size).toBe(5)
    expect(definition.states[def]).toBeDefined()
    for (const state of manual) expect(definition.states[state]).toBeDefined()
  })

  it("compiles exactly one template-form reviewBase, and no truthy reviewBase on plan-gate/spec-gate", () => {
    // `review-gate.check` fixes the whole process's diff base to a
    // manually-supplied commitish (a template string, via its `$reviewBase`
    // binding). `plan-gate.check`/`spec-gate.check` bind the same param to
    // the literal empty string, which compiles away to "field absent".
    const { definition } = compileTemplate()
    const states = definition.states
    const templateReviewBase = Object.entries(states).filter(
      ([, s]) => typeof s.reviewBase === "string",
    )
    expect(templateReviewBase.map(([name]) => name)).toEqual(["review-gate.check"])
    expect(states["plan-gate.check"]!.reviewBase).toBeUndefined()
    expect(states["spec-gate.check"]!.reviewBase).toBeUndefined()
  })

  it("exposes the compiled default as the built-in fallback (definition + its own vars)", () => {
    // `src/Config.ts` and the in-memory test layer fall back to these when no
    // `workflow:` is configured — so they must be the same compiled shape the
    // template produces, with the template's own `vars:` defaults intact.
    expect(validateDefinition(defaultWorkflowDefinition)).toEqual([])
    expect(defaultWorkflowDefinition).toEqual(compileTemplate().definition)
    expect(defaultWorkflowVars).toEqual(compileTemplate().vars)
    expect(defaultWorkflowVars.testCommand).toBe("npm test")
  })

  it("exposes defaultStateScopes covering every state in the compiled default", () => {
    // src/Config.ts exposes this as ConfigOperations.stateScopes for the
    // built-in default — it must be the same scopes map the template
    // produces, with an entry for every single compiled state.
    expect(defaultStateScopes).toEqual(compileTemplate().scopes)
    expect(Object.keys(defaultStateScopes).sort()).toEqual(
      Object.keys(defaultWorkflowDefinition.states).sort(),
    )
  })

  it("renders the full workflow config with the $schema key first (renderInitConfig)", () => {
    // renderInitConfig materializes the built-in default into a `workflow:`
    // config — the way to eject/customize the machine, and the hermetic
    // `Given the workflow` test fixture (modes-free).
    const rendered = renderInitConfig()
    const parsed = JSON.parse(rendered) as { $schema: string; workflow: unknown; modes?: unknown }
    expect(parsed.$schema).toBe(SCHEMA_URL)
    expect(parsed.workflow).toBeTypeOf("object")
    expect(parsed.modes).toBeUndefined()
    expect(rendered.endsWith("\n")).toBe(true)
  })

  describe("renderInitScaffold — the minimal config `gtd init` writes", () => {
    it("seeds only the default vars and the Prettier modes suggestion, no workflow", () => {
      const { config } = renderInitScaffold()
      const parsed = JSON.parse(config) as {
        $schema: string
        vars: unknown
        modes: unknown
        workflow?: unknown
      }
      expect(parsed.$schema).toBe(SCHEMA_URL)
      expect(parsed.vars).toEqual(INIT_VARS)
      expect(parsed.modes).toEqual(MODES_SUGGESTION)
      // The workflow is built in — init never writes it.
      expect(parsed.workflow).toBeUndefined()
      expect(config.endsWith("\n")).toBe(true)
    })

    it("seeds testCommand as the one variable a fresh project usually changes", () => {
      const { config } = renderInitScaffold()
      const parsed = JSON.parse(config) as { vars: { testCommand?: string } }
      expect(parsed.vars.testCommand).toBe("npm test")
    })

    it("seeds a format-only Prettier suggestion for qa/review (gtd still validates)", () => {
      expect(MODES_SUGGESTION.qa.format).toContain("prettier")
      expect(MODES_SUGGESTION.review.format).toContain("prettier")
      expect(MODES_SUGGESTION.qa).not.toHaveProperty("validate")
      expect(MODES_SUGGESTION.review).not.toHaveProperty("validate")
    })
  })
})

describe("the bundled template's machine boundaries line up with conversational identity (package 08)", () => {
  // These invariants are about the RAW `machines:` source, not the compiled
  // (flattened) definition — the compiler STAMPS a machine-level `model:`
  // onto every one of its own `prompt` states (src/Machines.ts's
  // `resolveInstanceModel`), so by the time a state is compiled it always
  // carries a `model` whether it was declared machine-level or (the thing
  // this restructure eliminates) state-level. Only the raw source can tell
  // the two apart.
  const raw = parseYaml(unifiedYaml) as {
    readonly machines: Readonly<
      Record<
        string,
        {
          readonly model?: string
          readonly states: Readonly<Record<string, Readonly<Record<string, unknown>>>>
        }
      >
    >
  }

  /** A local is a REFERENCE iff its raw value carries a `machine` key — mirrors `src/Machines.ts`'s own `isRef`. */
  const isRef = (v: Record<string, unknown>): boolean => typeof v["machine"] === "string"

  /** Every one of `machineName`'s own (non-reference) local names whose raw value declares a `prompt` key — this machine's own `prompt`-content states, never a nested child's. */
  const ownPromptStates = (machineName: string): readonly string[] =>
    Object.entries(raw.machines[machineName]!.states)
      .filter(([, s]) => !isRef(s) && typeof s["prompt"] === "string")
      .map(([name]) => name)
      .sort()

  it("no state anywhere declares `model` directly — every model comes from its owning machine", () => {
    for (const [machineName, machine] of Object.entries(raw.machines)) {
      for (const [stateName, state] of Object.entries(machine.states)) {
        if (isRef(state)) continue
        expect(state, `machine "${machineName}" state "${stateName}"`).not.toHaveProperty("model")
      }
    }
  })

  it("no state anywhere declares `memory` — the key is computed from the machine tree, not authored", () => {
    for (const [machineName, machine] of Object.entries(raw.machines)) {
      for (const [stateName, state] of Object.entries(machine.states)) {
        if (isRef(state)) continue
        expect(state, `machine "${machineName}" state "${stateName}"`).not.toHaveProperty("memory")
      }
    }
  })

  it("every machine that contains a `prompt`-content state declares exactly one `model`", () => {
    for (const [machineName, machine] of Object.entries(raw.machines)) {
      if (ownPromptStates(machineName).length === 0) continue
      expect(typeof machine.model, `machine "${machineName}"`).toBe("string")
    }
  })

  it("the identity table holds: product/technical/plan/build/packages.item/packages.item.spec/review are each exactly one of {planner, coder}, matching the tree", () => {
    const { tree } = compileTemplate()
    // Instance path (e.g. "packages.item") -> the machine it instantiates.
    const machineAt: Record<string, string> = {}
    const walk = (node: MachineNode): void => {
      machineAt[node.key] = node.machine
      node.children.forEach(walk)
    }
    walk(tree)

    const identityOf = (instancePath: string): "planner" | "coder" | undefined => {
      const model = raw.machines[machineAt[instancePath]!]?.model
      if (model === undefined) return undefined
      if (model.includes("plannerModel")) return "planner"
      if (model.includes("coderModel")) return "coder"
      throw new Error(`instance "${instancePath}": unrecognized model template "${model}"`)
    }

    expect(identityOf("product")).toBe("planner")
    expect(identityOf("technical")).toBe("planner")
    expect(identityOf("plan")).toBe("planner")
    expect(identityOf("build")).toBe("coder")
    expect(identityOf("packages.item")).toBe("coder")
    expect(identityOf("packages.item.spec")).toBe("planner")
    expect(identityOf("review")).toBe("planner")
  })

  it("packages, build.health, packages.item.health, plan-gate, spec-gate, and review-gate have no model — they are identity-free gate/queue machines", () => {
    const { tree } = compileTemplate()
    const machineAt: Record<string, string> = {}
    const walk = (node: MachineNode): void => {
      machineAt[node.key] = node.machine
      node.children.forEach(walk)
    }
    walk(tree)

    for (const instancePath of [
      "packages",
      "build.health",
      "packages.item.health",
      "plan-gate",
      "spec-gate",
      "review-gate",
    ]) {
      expect(raw.machines[machineAt[instancePath]!]?.model, instancePath).toBeUndefined()
    }
  })

  it("no machine contains BOTH a review-content prompt state AND an implementer-content prompt state — the planner/coder identities never overlap within one machine", () => {
    // Planner machines: every one of their OWN prompt states is a
    // plan-development/review action, never a write-code one.
    expect(ownPromptStates("qaLoop")).toEqual(["author"])
    expect(ownPromptStates("planLoop")).toEqual(["planning"])
    expect(ownPromptStates("humanReview")).toEqual(["collecting", "reviewing"])
    expect(ownPromptStates("specReview")).toEqual(["review"])

    // Coder machines: every one of their OWN prompt states is a
    // write/fix-code action, never a plan-development/review one.
    expect(ownPromptStates("packageItem")).toEqual(["building", "fix-spec", "fix-suite"])
    expect(ownPromptStates("simpleBuild")).toEqual([
      "addressing",
      "building",
      "decompose",
      "fix",
      "squashing",
    ])

    // Identity-free gate/queue machines own no prompt state at all.
    expect(ownPromptStates("entryGate")).toEqual([])
    expect(ownPromptStates("healthGate")).toEqual([])
    expect(ownPromptStates("packageLoop")).toEqual([])
  })
})
