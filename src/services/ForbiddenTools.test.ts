import { describe, it, expect } from "@effect/vitest"
import {
  FORBIDDEN_TOOLS,
  AGENT_TOOL_CATALOG,
  type AgentProviderType,
} from "./ForbiddenTools.js"

describe("ForbiddenTools", () => {
  describe("AGENT_TOOL_CATALOG", () => {
    it("contains a catalog for each agent provider", () => {
      const providers: AgentProviderType[] = ["pi", "opencode", "claude"]
      for (const provider of providers) {
        expect(AGENT_TOOL_CATALOG[provider]).toBeDefined()
        expect(AGENT_TOOL_CATALOG[provider].length).toBeGreaterThan(0)
      }
    })

    it("pi catalog contains expected built-in tools", () => {
      const piTools = AGENT_TOOL_CATALOG.pi
      expect(piTools).toContain("read")
      expect(piTools).toContain("bash")
      expect(piTools).toContain("edit")
      expect(piTools).toContain("write")
    })

    it("opencode catalog contains expected built-in tools", () => {
      const ocTools = AGENT_TOOL_CATALOG.opencode
      expect(ocTools).toContain("bash")
      expect(ocTools).toContain("read")
      expect(ocTools).toContain("edit")
      expect(ocTools).toContain("write")
      expect(ocTools).toContain("glob")
      expect(ocTools).toContain("grep")
      expect(ocTools).toContain("question")
      expect(ocTools).toContain("task")
      expect(ocTools).toContain("webfetch")
      expect(ocTools).toContain("websearch")
    })

    it("claude catalog contains expected built-in tools", () => {
      const claudeTools = AGENT_TOOL_CATALOG.claude
      expect(claudeTools).toContain("Bash")
      expect(claudeTools).toContain("FileRead")
      expect(claudeTools).toContain("FileEdit")
      expect(claudeTools).toContain("FileWrite")
      expect(claudeTools).toContain("Glob")
      expect(claudeTools).toContain("Grep")
      expect(claudeTools).toContain("AskUserQuestion")
      expect(claudeTools).toContain("Agent")
      expect(claudeTools).toContain("WebFetch")
      expect(claudeTools).toContain("WebSearch")
    })
  })

  describe("FORBIDDEN_TOOLS", () => {
    it("claude blocklist contains AskUserQuestion", () => {
      expect(FORBIDDEN_TOOLS.claude).toContain("AskUserQuestion")
    })

    it("opencode blocklist contains question", () => {
      expect(FORBIDDEN_TOOLS.opencode).toContain("question")
    })

    it("pi blocklist is empty (no built-in interactive tools)", () => {
      expect(FORBIDDEN_TOOLS.pi).toEqual([])
    })

    it("every forbidden tool is in the corresponding agent catalog", () => {
      const providers: AgentProviderType[] = ["pi", "opencode", "claude"]
      for (const provider of providers) {
        for (const tool of FORBIDDEN_TOOLS[provider]) {
          expect(
            AGENT_TOOL_CATALOG[provider],
            `Forbidden tool "${tool}" for ${provider} should be in its catalog`,
          ).toContain(tool)
        }
      }
    })

    it("only interactive tools are in the forbidden lists", () => {
      expect(FORBIDDEN_TOOLS.claude).not.toContain("Bash")
      expect(FORBIDDEN_TOOLS.claude).not.toContain("FileRead")
      expect(FORBIDDEN_TOOLS.claude).not.toContain("FileWrite")
      expect(FORBIDDEN_TOOLS.opencode).not.toContain("bash")
      expect(FORBIDDEN_TOOLS.opencode).not.toContain("read")
      expect(FORBIDDEN_TOOLS.opencode).not.toContain("write")
    })
  })

  describe("snapshot: tool catalogs match expected sets", () => {
    it("pi tool catalog snapshot", () => {
      expect(AGENT_TOOL_CATALOG.pi).toMatchSnapshot()
    })

    it("opencode tool catalog snapshot", () => {
      expect(AGENT_TOOL_CATALOG.opencode).toMatchSnapshot()
    })

    it("claude tool catalog snapshot", () => {
      expect(AGENT_TOOL_CATALOG.claude).toMatchSnapshot()
    })

    it("pi forbidden tools snapshot", () => {
      expect(FORBIDDEN_TOOLS.pi).toMatchSnapshot()
    })

    it("opencode forbidden tools snapshot", () => {
      expect(FORBIDDEN_TOOLS.opencode).toMatchSnapshot()
    })

    it("claude forbidden tools snapshot", () => {
      expect(FORBIDDEN_TOOLS.claude).toMatchSnapshot()
    })
  })
})
