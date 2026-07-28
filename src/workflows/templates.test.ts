import { describe, expect, it } from "vitest"
import { validateDefinition } from "../PatternMachine.js"
import {
  compileTemplate,
  MODES_SUGGESTION,
  PROMPTS_DIR,
  renderInitConfig,
  renderInitScaffold,
  SCHEMA_URL,
} from "./templates.js"

/** Shape of a scaffolded config's `workflow.states` after prompt extraction. */
type ScaffoldStates = Record<
  string,
  { prompt?: string; message?: string; script?: string; commit?: string }
>
const scaffoldStates = (config: string): ScaffoldStates =>
  (JSON.parse(config) as { workflow: { states: ScaffoldStates } }).workflow.states

describe("the bundled unified workflow template", () => {
  it("compiles with no validation findings and exactly one initial state", () => {
    const { definition } = compileTemplate()
    expect(validateDefinition(definition)).toEqual([])
    const initial = Object.values(definition.states).filter((s) => s.initial)
    expect(initial).toHaveLength(1)
  })

  it("declares exactly one review checkout window and one review entry", () => {
    // The cycle runs to a human review gate, so it must declare exactly one
    // `reviewWindow: true` state (the gate that opens the editor's checkout
    // window) and exactly one `reviewEntry: true` state (the
    // `gtd review <commitish>` entry point) — see src/ReviewWindow.ts /
    // STATES.md §11.
    const { definition } = compileTemplate()
    const states = Object.values(definition.states)
    expect(states.filter((s) => s.reviewWindow === true)).toHaveLength(1)
    expect(states.filter((s) => s.reviewEntry === true)).toHaveLength(1)
  })

  it("declares exactly one review-base state anchoring the incremental review window", () => {
    const { definition } = compileTemplate()
    const states = Object.values(definition.states)
    expect(states.filter((s) => s.reviewBase === true)).toHaveLength(1)
  })

  it("forks the initial state on the two entry files", () => {
    // idle routes `.gtd/REQUIREMENTS.md` to the advanced flow and everything
    // else (e.g. `.gtd/TODO.md`) to the simple flow — the REQUIREMENTS row is
    // declared first so it wins.
    const { definition } = compileTemplate()
    const idle = definition.states.idle!
    const targets = (idle.on ?? []).map(([, to]) => to)
    expect(targets).toContain("adv-grilling")
    expect(targets).toContain("planning")
  })

  it("renders a valid .gtdrc.json with the $schema key first", () => {
    const rendered = renderInitConfig()
    const parsed = JSON.parse(rendered) as { $schema: string; workflow: unknown }
    expect(parsed.$schema).toBe(SCHEMA_URL)
    expect(parsed.workflow).toBeTypeOf("object")
    expect(rendered.endsWith("\n")).toBe(true)
  })

  describe("renderInitScaffold", () => {
    it("extracts every agent prompt to a gtd-prompts/<state>.md file and references it from the config", () => {
      const { config, prompts } = renderInitScaffold()
      const states = scaffoldStates(config)
      const inlineStates = scaffoldStates(renderInitConfig())
      const promptStates = Object.entries(inlineStates)
        .filter(([, s]) => typeof s.prompt === "string")
        .map(([stateName]) => stateName)

      expect(promptStates.length).toBeGreaterThan(0)
      expect(prompts.map((p) => p.path).sort()).toEqual(
        promptStates.map((s) => `${PROMPTS_DIR}/${s}.md`).sort(),
      )
      for (const stateName of promptStates) {
        const path = `${PROMPTS_DIR}/${stateName}.md`
        expect(states[stateName]!.prompt).toBe(`./${path}`)
        const file = prompts.find((p) => p.path === path)
        expect(file?.content).toBe(inlineStates[stateName]!.prompt)
      }
    })

    it("leaves human messages, check scripts, and commit templates inline in the config", () => {
      const states = scaffoldStates(renderInitScaffold().config)
      for (const state of Object.values(states)) {
        expect(state.message?.startsWith("./")).not.toBe(true)
        expect(state.script?.startsWith("./")).not.toBe(true)
        expect(state.commit?.startsWith("./")).not.toBe(true)
      }
      const inline = scaffoldStates(renderInitConfig())
      for (const [stateName, s] of Object.entries(inline)) {
        if (s.message !== undefined) expect(states[stateName]!.message).toBe(s.message)
        if (s.script !== undefined) expect(states[stateName]!.script).toBe(s.script)
        if (s.commit !== undefined) expect(states[stateName]!.commit).toBe(s.commit)
      }
    })

    it("keeps the $schema key first and ends with a newline", () => {
      const { config } = renderInitScaffold()
      const parsed = JSON.parse(config) as { $schema: string }
      expect(parsed.$schema).toBe(SCHEMA_URL)
      expect(config.endsWith("\n")).toBe(true)
    })

    it("seeds the top-level `modes:` Prettier suggestion for qa/review (format only)", () => {
      const { config } = renderInitScaffold()
      const parsed = JSON.parse(config) as { modes?: unknown }
      expect(parsed.modes).toEqual(MODES_SUGGESTION)
      expect(MODES_SUGGESTION.qa.format).toContain("prettier")
      expect(MODES_SUGGESTION.review.format).toContain("prettier")
      expect(MODES_SUGGESTION.qa).not.toHaveProperty("validate")
      expect(MODES_SUGGESTION.review).not.toHaveProperty("validate")
    })

    it("does NOT seed `modes:` in the hermetic base config (renderInitConfig)", () => {
      // renderInitConfig doubles as the `Given the workflow` test fixture; it
      // must stay modes-free so gate scenarios never shell out to Prettier.
      const parsed = JSON.parse(renderInitConfig()) as { modes?: unknown }
      expect(parsed.modes).toBeUndefined()
    })
  })
})
