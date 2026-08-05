import { describe, expect, it } from "vitest"
import { validateDefinition } from "../PatternMachine.js"
import {
  compileTemplate,
  defaultWorkflowDefinition,
  defaultWorkflowVars,
  INIT_VARS,
  MODES_SUGGESTION,
  renderInitConfig,
  renderInitScaffold,
  SCHEMA_URL,
} from "./templates.js"

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

  it("declares exactly the four qualified assertGreen/fix-precheck states as manual entries", () => {
    // All three `assertGreen` instances (plan-gate/spec-gate/review-gate)
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
