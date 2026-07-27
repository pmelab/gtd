import { describe, expect, it } from "vitest"
import { validateDefinition } from "../PatternMachine.js"
import {
  compileTemplate,
  isWorkflowTemplateName,
  renderInitConfig,
  SCHEMA_URL,
  WORKFLOW_TEMPLATE_NAMES,
} from "./templates.js"

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

  it("isWorkflowTemplateName gates unknown names", () => {
    expect(isWorkflowTemplateName("simple")).toBe(true)
    expect(isWorkflowTemplateName("advanced")).toBe(true)
    expect(isWorkflowTemplateName("bogus")).toBe(false)
  })
})
