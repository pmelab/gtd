import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as kit from "./index.js"

describe("@pmelab/gtd/workflow-kit", () => {
  it("publishes its helpers by name, routeNotes deprecated among them", () => {
    expect(Object.keys(kit).sort()).toEqual(
      [
        "assertionLines",
        "escalation",
        "fixFindings",
        "gate",
        "healthy",
        "lensEntriesOf",
        "lensOf",
        "lensScopes",
        "lensesOf",
        "qualityLap",
        "removedAssertions",
        "review",
        "reviewToHandOff",
        "routeNotes",
        "untilSettled",
      ].sort(),
    )
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8")
    expect(source).toMatch(/\/\*\* @deprecated [^\n]*\*\/\nexport const routeNotes =/)
  })
})
