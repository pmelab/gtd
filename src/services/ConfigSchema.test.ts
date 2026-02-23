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
      agent: "claude",
      modelPlan: "architect",
      modelBuild: "coder",
      modelLearn: "teacher",
      modelCommit: "summarizer",
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

  it("gracefully ignores old agentPlan/agentBuild/agentLearn fields for backwards compatibility", () => {
    const input = {
      file: "TODO.md",
      agentPlan: "architect",
      agentBuild: "coder",
      agentLearn: "teacher",
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.file).toBe("TODO.md")
    expect((result as Record<string, unknown>).agentPlan).toBeUndefined()
    expect((result as Record<string, unknown>).agentBuild).toBeUndefined()
    expect((result as Record<string, unknown>).agentLearn).toBeUndefined()
  })

  it("parses modelCommit field correctly", () => {
    const input = { modelCommit: "gpt-4" }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.modelCommit).toBe("gpt-4")
  })

  it("parses modelExplore field correctly", () => {
    const input = { modelExplore: "claude-opus-4-5" }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.modelExplore).toBe("claude-opus-4-5")
  })

  it("modelExplore is undefined when omitted", () => {
    const result = Schema.decodeUnknownSync(GtdConfigSchema)({})
    expect((result as Record<string, unknown>).modelExplore).toBeUndefined()
  })

  it("gracefully ignores old agentForbiddenTools field for backwards compatibility", () => {
    const input = {
      file: "TODO.md",
      agentForbiddenTools: ["AskUserQuestion"],
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.file).toBe("TODO.md")
    expect((result as Record<string, unknown>).agentForbiddenTools).toBeUndefined()
  })

  it("config parsing works without agentForbiddenTools field", () => {
    const input = {
      file: "PLAN.md",
      agent: "claude",
      testRetries: 5,
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.file).toBe("PLAN.md")
    expect(result.agent).toBe("claude")
    expect(result.testRetries).toBe(5)
  })

  it("parses sandboxBoundaries with filesystem overrides only", () => {
    const input = {
      sandboxBoundaries: {
        filesystem: {
          allowRead: ["/shared/libs"],
          allowWrite: ["/shared/output"],
        },
      },
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.sandboxBoundaries).toEqual({
      filesystem: {
        allowRead: ["/shared/libs"],
        allowWrite: ["/shared/output"],
      },
    })
  })

  it("parses sandboxBoundaries with network overrides only", () => {
    const input = {
      sandboxBoundaries: {
        network: {
          allowedDomains: ["registry.npmjs.org"],
        },
      },
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.sandboxBoundaries).toEqual({
      network: { allowedDomains: ["registry.npmjs.org"] },
    })
  })

  it("rejects old phase-level boundary levels in sandboxBoundaries", () => {
    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema, { onExcessProperty: "error" })({
        sandboxBoundaries: { plan: "restricted" },
      }),
    ).toThrow()
  })

  it("gracefully ignores old sandboxEscalationPolicy for backwards compatibility", () => {
    const result = Schema.decodeUnknownSync(GtdConfigSchema)({
      sandboxEscalationPolicy: "auto",
    })
    expect((result as Record<string, unknown>).sandboxEscalationPolicy).toBeUndefined()
  })

  it("gracefully ignores old sandboxApprovedEscalations for backwards compatibility", () => {
    const result = Schema.decodeUnknownSync(GtdConfigSchema)({
      sandboxApprovedEscalations: [{ from: "restricted", to: "standard" }],
    })
    expect((result as Record<string, unknown>).sandboxApprovedEscalations).toBeUndefined()
  })

  it("parses config with all sandbox fields together", () => {
    const input = {
      file: "TODO.md",
      sandboxEnabled: true,
      sandboxBoundaries: {
        filesystem: { allowRead: ["/shared"] },
        network: { allowedDomains: ["npmjs.org"] },
      },
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.sandboxEnabled).toBe(true)
    expect(result.sandboxBoundaries).toEqual({
      filesystem: { allowRead: ["/shared"] },
      network: { allowedDomains: ["npmjs.org"] },
    })
  })

  it("sandbox fields default to undefined when omitted", () => {
    const result = Schema.decodeUnknownSync(GtdConfigSchema)({})
    expect(result.sandboxBoundaries).toBeUndefined()
  })

  it("parses sandboxBoundaries with both filesystem and network overrides", () => {
    const input = {
      sandboxBoundaries: {
        filesystem: { allowWrite: ["/tmp"], allowRead: ["/shared"] },
        network: { allowedDomains: ["npmjs.org"] },
      },
    }
    const result = Schema.decodeUnknownSync(GtdConfigSchema)(input)
    expect(result.sandboxBoundaries!.filesystem).toEqual({ allowWrite: ["/tmp"], allowRead: ["/shared"] })
    expect(result.sandboxBoundaries!.network).toEqual({ allowedDomains: ["npmjs.org"] })
  })

  it("rejects invalid types in filesystem overrides", () => {
    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema)({
        sandboxBoundaries: { filesystem: { allowRead: "not-an-array" } },
      }),
    ).toThrow()
  })

  it("rejects invalid types in network overrides", () => {
    expect(() =>
      Schema.decodeUnknownSync(GtdConfigSchema)({
        sandboxBoundaries: { network: { allowedDomains: "not-an-array" } },
      }),
    ).toThrow()
  })
})
