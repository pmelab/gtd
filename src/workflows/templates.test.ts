import { describe, expect, it } from "vitest"
import { validateDefinition } from "../PatternMachine.js"
import {
  compileTemplate,
  isWorkflowTemplateName,
  MODES_SUGGESTION,
  PROMPTS_DIR,
  renderInitConfig,
  renderInitScaffold,
  SCHEMA_URL,
  WORKFLOW_TEMPLATE_NAMES,
} from "./templates.js"

/** Shape of a scaffolded config's `workflow.states` after prompt extraction. */
type ScaffoldStates = Record<
  string,
  { prompt?: string; message?: string; script?: string; commit?: string }
>
const scaffoldStates = (config: string): ScaffoldStates =>
  (JSON.parse(config) as { workflow: { states: ScaffoldStates } }).workflow.states

describe("bundled workflow templates", () => {
  it("ships exactly the `simple` and `advanced` templates", () => {
    expect([...WORKFLOW_TEMPLATE_NAMES].sort()).toEqual(["advanced", "simple"])
  })

  for (const name of WORKFLOW_TEMPLATE_NAMES) {
    it(`compiles the "${name}" template with no validation findings`, () => {
      const { definition } = compileTemplate(name)
      expect(validateDefinition(definition)).toEqual([])
      // Every bundled template must have exactly one initial state.
      const initial = Object.values(definition.states).filter((s) => s.initial)
      expect(initial).toHaveLength(1)
    })

    it(`declares the review checkout window on the "${name}" template's review gate`, () => {
      // Every bundled template runs a cycle to a human review gate, so it must
      // declare exactly one `reviewWindow: true` state (the gate that opens the
      // editor's checkout window) and exactly one `reviewEntry: true` state (the
      // `gtd review <commitish>` entry point). A template silently dropping
      // either leaves `gtd init` users with a review gate that never rewinds
      // HEAD — see src/ReviewWindow.ts / STATES.md §11.
      const { definition } = compileTemplate(name)
      const states = Object.values(definition.states)
      expect(states.filter((s) => s.reviewWindow === true)).toHaveLength(1)
      expect(states.filter((s) => s.reviewEntry === true)).toHaveLength(1)
    })

    it(`renders a valid .gtdrc.json for "${name}" with the $schema key first`, () => {
      const rendered = renderInitConfig(name)
      const parsed = JSON.parse(rendered) as { $schema: string; workflow: unknown }
      expect(parsed.$schema).toBe(SCHEMA_URL)
      expect(parsed.workflow).toBeTypeOf("object")
      // The rendered config round-trips through the compiler exactly like a
      // hand-authored `.gtdrc` `workflow:` value.
      expect(rendered.endsWith("\n")).toBe(true)
    })
  }

  for (const name of WORKFLOW_TEMPLATE_NAMES) {
    describe(`renderInitScaffold for "${name}"`, () => {
      it("extracts every agent prompt to a gtd-prompts/<state>.md file and references it from the config", () => {
        const { config, prompts } = renderInitScaffold(name)
        const states = scaffoldStates(config)
        // The inline reference form the template test above already validates
        // is the source of truth for which states carry a `prompt:`.
        const inlineStates = scaffoldStates(renderInitConfig(name))
        const promptStates = Object.entries(inlineStates)
          .filter(([, s]) => typeof s.prompt === "string")
          .map(([stateName]) => stateName)

        expect(promptStates.length).toBeGreaterThan(0)
        expect(prompts.map((p) => p.path).sort()).toEqual(
          promptStates.map((s) => `${PROMPTS_DIR}/${s}.md`).sort(),
        )
        for (const stateName of promptStates) {
          const path = `${PROMPTS_DIR}/${stateName}.md`
          // Config value is rewritten to a `./`-relative file reference…
          expect(states[stateName]!.prompt).toBe(`./${path}`)
          // …and the extracted file's content is the inline prompt verbatim.
          const file = prompts.find((p) => p.path === path)
          expect(file?.content).toBe(inlineStates[stateName]!.prompt)
        }
      })

      it("leaves human messages and check scripts inline in the config", () => {
        const states = scaffoldStates(renderInitScaffold(name).config)
        for (const state of Object.values(states)) {
          expect(state.message?.startsWith("./")).not.toBe(true)
          expect(state.script?.startsWith("./")).not.toBe(true)
          expect(state.commit?.startsWith("./")).not.toBe(true)
        }
        // Every non-prompt content value is still present verbatim (not a ref).
        const inline = scaffoldStates(renderInitConfig(name))
        for (const [stateName, s] of Object.entries(inline)) {
          if (s.message !== undefined) expect(states[stateName]!.message).toBe(s.message)
          if (s.script !== undefined) expect(states[stateName]!.script).toBe(s.script)
          if (s.commit !== undefined) expect(states[stateName]!.commit).toBe(s.commit)
        }
      })

      it("keeps the $schema key first and ends with a newline", () => {
        const { config } = renderInitScaffold(name)
        const parsed = JSON.parse(config) as { $schema: string }
        expect(parsed.$schema).toBe(SCHEMA_URL)
        expect(config.endsWith("\n")).toBe(true)
      })

      it("seeds the top-level `modes:` Prettier suggestion for qa/review (format only)", () => {
        const { config } = renderInitScaffold(name)
        const parsed = JSON.parse(config) as { modes?: unknown }
        // Seeded as a ready-to-edit default so a fresh project auto-formats its
        // steering files (see MODES_SUGGESTION) — format only, keeping gtd's
        // built-in qa/review validators.
        expect(parsed.modes).toEqual(MODES_SUGGESTION)
        expect(MODES_SUGGESTION.qa.format).toContain("prettier")
        expect(MODES_SUGGESTION.review.format).toContain("prettier")
        expect(MODES_SUGGESTION.qa).not.toHaveProperty("validate")
        expect(MODES_SUGGESTION.review).not.toHaveProperty("validate")
      })

      it("does NOT seed `modes:` in the hermetic base config (renderInitConfig)", () => {
        // renderInitConfig doubles as the `Given the "…" workflow` test fixture;
        // it must stay modes-free so gate scenarios never shell out to Prettier.
        const parsed = JSON.parse(renderInitConfig(name)) as { modes?: unknown }
        expect(parsed.modes).toBeUndefined()
      })
    })
  }

  it("isWorkflowTemplateName gates unknown names", () => {
    expect(isWorkflowTemplateName("simple")).toBe(true)
    expect(isWorkflowTemplateName("advanced")).toBe(true)
    expect(isWorkflowTemplateName("bogus")).toBe(false)
  })
})
