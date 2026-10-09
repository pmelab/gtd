import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as evalConfig from "../../evals/gtd.config.js"

// Each eval case starts the workflow evals/gtd.config.ts exports for its step:
// the step's full name in camelCase (the same rule as evals/fixture.mjs).
const workflowName = (state: string): string =>
  state.replace(/[^A-Za-z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
const CASES_DIR = new URL("../../evals/cases/", import.meta.url)

describe("evals/cases", () => {
  it("names a bundled agent step in every case", async () => {
    const files = readdirSync(CASES_DIR).filter((file) => file.endsWith(".mjs"))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const { default: caseDef } = (await import(new URL(file, CASES_DIR).href)) as {
        default: { state: string }
      }
      expect(Object.keys(evalConfig), file).toContain(workflowName(caseDef.state))
    }
  })
})
