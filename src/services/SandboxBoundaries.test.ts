import { describe, it, expect } from "@effect/vitest"
import * as SandboxBoundaries from "./SandboxBoundaries.js"
import {
  type BoundaryLevel,
  boundaryForPhase,
  BOUNDARY_LEVELS,
  AGENT_ESSENTIAL_DOMAINS,
  defaultFilesystemConfig,
  defaultNetworkConfig,
} from "./SandboxBoundaries.js"
import type { AgentProviderType } from "./ForbiddenTools.js"

describe("SandboxBoundaries", () => {
  describe("BoundaryLevel", () => {
    it("defines three levels in order of increasing permission", () => {
      expect(BOUNDARY_LEVELS).toEqual(["restricted", "standard", "elevated"])
    })

    it("restricted is the most constrained level", () => {
      const level: BoundaryLevel = "restricted"
      expect(BOUNDARY_LEVELS.indexOf(level)).toBe(0)
    })

    it("elevated is the least constrained level", () => {
      const level: BoundaryLevel = "elevated"
      expect(BOUNDARY_LEVELS.indexOf(level)).toBe(2)
    })
  })

  describe("boundaryForPhase", () => {
    it("plan phase maps to restricted", () => {
      expect(boundaryForPhase("plan")).toBe("restricted")
    })

    it("build phase maps to standard", () => {
      expect(boundaryForPhase("build")).toBe("standard")
    })

    it("learn phase maps to restricted", () => {
      expect(boundaryForPhase("learn")).toBe("restricted")
    })

    it("boundary level is fully determined by phase (no runtime transitions)", () => {
      const planLevel = boundaryForPhase("plan")
      const buildLevel = boundaryForPhase("build")
      const learnLevel = boundaryForPhase("learn")
      expect(planLevel).toBe("restricted")
      expect(buildLevel).toBe("standard")
      expect(learnLevel).toBe("restricted")
    })
  })

  describe("no dynamic escalation", () => {
    it("module does not export shouldEscalate", () => {
      expect("shouldEscalate" in SandboxBoundaries).toBe(false)
    })

    it("module does not export escalateBoundary", () => {
      expect("escalateBoundary" in SandboxBoundaries).toBe(false)
    })
  })

  describe("AGENT_ESSENTIAL_DOMAINS", () => {
    it("defines essential domains for each agent provider", () => {
      const providers: AgentProviderType[] = ["pi", "opencode", "claude"]
      for (const provider of providers) {
        expect(AGENT_ESSENTIAL_DOMAINS[provider]).toBeDefined()
        expect(AGENT_ESSENTIAL_DOMAINS[provider].length).toBeGreaterThan(0)
      }
    })

    it("claude essential domains include anthropic API endpoints", () => {
      expect(AGENT_ESSENTIAL_DOMAINS.claude).toContain("api.anthropic.com")
    })

    it("opencode essential domains include opencode API endpoints", () => {
      expect(AGENT_ESSENTIAL_DOMAINS.opencode.length).toBeGreaterThan(0)
    })

    it("pi essential domains include anthropic API endpoints", () => {
      expect(AGENT_ESSENTIAL_DOMAINS.pi).toContain("api.anthropic.com")
    })
  })

  describe("defaultFilesystemConfig", () => {
    it("restricts allowWrite to cwd by default", () => {
      const config = defaultFilesystemConfig("/my/project")
      expect(config.allowWrite).toEqual(["/my/project"])
    })

    it("restricts allowRead to cwd by default", () => {
      const config = defaultFilesystemConfig("/my/project")
      expect(config.allowRead).toEqual(["/my/project"])
    })

    it("extends allowed paths with user config allowWrite", () => {
      const config = defaultFilesystemConfig("/my/project", {
        allowWrite: ["/shared/output"],
      })
      expect(config.allowWrite).toContain("/my/project")
      expect(config.allowWrite).toContain("/shared/output")
    })

    it("extends allowed paths with user config allowRead", () => {
      const config = defaultFilesystemConfig("/my/project", {
        allowRead: ["/shared/libs"],
      })
      expect(config.allowRead).toContain("/my/project")
      expect(config.allowRead).toContain("/shared/libs")
    })

    it("deduplicates paths when user config includes cwd", () => {
      const config = defaultFilesystemConfig("/my/project", {
        allowWrite: ["/my/project", "/other"],
      })
      const cwdCount = config.allowWrite.filter((p) => p === "/my/project").length
      expect(cwdCount).toBe(1)
      expect(config.allowWrite).toContain("/other")
    })

    it("paths outside cwd are denied by default (not in allowRead or allowWrite)", () => {
      const config = defaultFilesystemConfig("/my/project")
      expect(config.allowRead).not.toContain("/other/path")
      expect(config.allowWrite).not.toContain("/other/path")
    })
  })

  describe("defaultNetworkConfig", () => {
    it("only allows agent-essential domains by default", () => {
      const config = defaultNetworkConfig("claude")
      expect(config.allowedDomains).toEqual(AGENT_ESSENTIAL_DOMAINS.claude)
    })

    it("user config extends (not replaces) the essential allowlist", () => {
      const config = defaultNetworkConfig("claude", {
        allowedDomains: ["registry.npmjs.org"],
      })
      for (const domain of AGENT_ESSENTIAL_DOMAINS.claude) {
        expect(config.allowedDomains).toContain(domain)
      }
      expect(config.allowedDomains).toContain("registry.npmjs.org")
    })

    it("deduplicates domains when user config includes an essential domain", () => {
      const config = defaultNetworkConfig("claude", {
        allowedDomains: ["api.anthropic.com", "custom.api.com"],
      })
      const anthropicCount = config.allowedDomains.filter((d) => d === "api.anthropic.com").length
      expect(anthropicCount).toBe(1)
      expect(config.allowedDomains).toContain("custom.api.com")
    })

    it("requests to non-allowed domains are denied (not in allowedDomains)", () => {
      const config = defaultNetworkConfig("claude")
      expect(config.allowedDomains).not.toContain("evil.com")
    })

    it("uses correct essential domains for each provider", () => {
      const providers: AgentProviderType[] = ["pi", "opencode", "claude"]
      for (const provider of providers) {
        const config = defaultNetworkConfig(provider)
        for (const domain of AGENT_ESSENTIAL_DOMAINS[provider]) {
          expect(config.allowedDomains).toContain(domain)
        }
      }
    })
  })
})
