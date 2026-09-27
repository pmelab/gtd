import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { evalSteps } from "../../evals/gtd.config.js"

// Each eval case enters its step through evals/gtd.config.ts, which only knows
// the bundled agent steps its `evalSteps` names.
const CASES_DIR = new URL("../../evals/cases/", import.meta.url)

describe("evals/cases", () => {
  it("names a bundled agent step in every case", async () => {
    const files = readdirSync(CASES_DIR).filter((file) => file.endsWith(".mjs"))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const { default: caseDef } = (await import(new URL(file, CASES_DIR).href)) as {
        default: { state: string }
      }
      expect(Object.keys(evalSteps), file).toContain(caseDef.state)
    }
  })
})
