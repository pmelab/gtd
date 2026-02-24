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
    expect(result.modelPlan).toBeUndefined()
    expect(result.modelBuild).toBeUndefined()
    expect(result.modelLearn).toBeUndefined()
    expect(result.modelCommit).toBeUndefined()
    expect(result.testCmd).toBeUndefined()
    expect(result.commitPrompt).toBeUndefined()
    expect(result.agentInactivityTimeout).toBeUndefined()
  })

  it("parses a full config correctly", () => {
    const input = {
      file: "TODO.md",
      modelPlan: "anthropic/claude-sonnet-4-20250514",
      modelBuild: "anthropic/claude-sonnet-4-20250514",
      modelLearn: "anthropic/claude-haiku-4-5-20251001",
      modelCommit: "anthropic/claude-haiku-4-5-20251001",
      testCmd: "bun test",
      testRetries: 3,
      commitPrompt: "custom prompt",
      agentInactivityTimeout: 60,
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
  })

  it("rejects unknown keys with onExcessProperty error", () => {
    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema, { onExcessProperty: "error" })({
        unknownKey: "value",
      }),
    ).toThrow()
  })

  it("parses modelCommit field correctly", () => {
    const input = { modelCommit: "anthropic/claude-haiku-4-5-20251001" }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.modelCommit).toBe("anthropic/claude-haiku-4-5-20251001")
  })
})
