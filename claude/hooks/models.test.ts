import { describe, expect, test } from "vitest"

import { subagentModel } from "./models"

describe("subagentModel", () => {
  test("role hints map like the bash driver's defaults", () => {
    expect(subagentModel("smart", {})).toBe("opus")
    expect(subagentModel("base", {})).toBe("sonnet")
  })

  test("the environment can remap a role", () => {
    expect(subagentModel("smart", { smart: "fable" })).toBe("fable")
    expect(subagentModel("base", { base: "claude-haiku-4-5-20251001" })).toBe("haiku")
  })

  test("aliases pass, full ids shorten, anything else inherits the session's model", () => {
    expect(subagentModel("haiku", {})).toBe("haiku")
    expect(subagentModel("claude-opus-5-5", {})).toBe("opus")
    expect(subagentModel("gpt-5", {})).toBeUndefined()
    expect(subagentModel(undefined, {})).toBeUndefined()
  })
})
