import { describe, it, expect } from "@effect/vitest"
import { Schema } from "effect"
import { GtdConfigSchema } from "./ConfigSchema.js"

describe("GtdConfigSchema", () => {
  it("parses a partial config correctly", () => {
    const input = {
      file: "PLAN.md",
      testRetries: 5,
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.file).toBe("PLAN.md")
    expect(result.testRetries).toBe(5)
    expect(result.agent).toBeUndefined()
    expect(result.agentPlan).toBeUndefined()
    expect(result.agentBuild).toBeUndefined()
    expect(result.agentLearn).toBeUndefined()
    expect(result.testCmd).toBeUndefined()
    expect(result.commitPrompt).toBeUndefined()
    expect(result.agentInactivityTimeout).toBeUndefined()
    expect(result.agentForbiddenTools).toBeUndefined()
  })

  it("parses a full config correctly", () => {
    const input = {
      file: "TODO.md",
      agent: "claude",
      agentPlan: "architect",
      agentBuild: "coder",
      agentLearn: "teacher",
      testCmd: "bun test",
      testRetries: 3,
      commitPrompt: "custom prompt",
      agentInactivityTimeout: 60,
      agentForbiddenTools: ["AskUserQuestion", "UserInput"],
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result).toEqual(input)
  })

  it("parses an empty config", () => {
    const result = Schema.decodeUnknownSync(GtdConfigSchema)({})
    expect(result).toEqual({})
  })

  it("rejects invalid types", () => {
    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema)({ file: 123 }),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema)({ testRetries: "not a number" }),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema)({ agentInactivityTimeout: "bad" }),
    ).toThrow()

    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema)({ agentForbiddenTools: "comma,separated" }),
    ).toThrow()
  })

  it("rejects unknown keys", () => {
    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema, { onExcessProperty: "error" })({
        unknownKey: "value",
      }),
    ).toThrow()
  })

  it("agentForbiddenTools accepts a JSON array of strings", () => {
    const result = Schema.decodeUnknownSync(GtdConfigSchema)({
      agentForbiddenTools: ["ToolA", "ToolB", "ToolC"],
    })
    expect(result.agentForbiddenTools).toEqual(["ToolA", "ToolB", "ToolC"])
  })

  it("agentForbiddenTools rejects non-string array elements", () => {
    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema)({
        agentForbiddenTools: [1, 2, 3],
      }),
    ).toThrow()
  })
})
