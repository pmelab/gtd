import { describe, expect, it } from "vitest"
import * as kit from "./index.js"

describe("@pmelab/gtd/workflow-kit", () => {
  it("publishes its helpers by name", () => {
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
        "untilSettled",
      ].sort(),
    )
  })
})
