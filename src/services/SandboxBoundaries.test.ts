import { describe, it, expect } from "@effect/vitest"
import {
  type BoundaryLevel,
  boundaryForPhase,
  shouldEscalate,
  escalateBoundary,
  BOUNDARY_LEVELS,
} from "./SandboxBoundaries.js"

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
  })

  describe("shouldEscalate", () => {
    it("returns true when target is higher than current", () => {
      expect(shouldEscalate("restricted", "standard")).toBe(true)
      expect(shouldEscalate("restricted", "elevated")).toBe(true)
      expect(shouldEscalate("standard", "elevated")).toBe(true)
    })

    it("returns false when target is same as current", () => {
      expect(shouldEscalate("restricted", "restricted")).toBe(false)
      expect(shouldEscalate("standard", "standard")).toBe(false)
      expect(shouldEscalate("elevated", "elevated")).toBe(false)
    })

    it("returns false when target is lower than current", () => {
      expect(shouldEscalate("standard", "restricted")).toBe(false)
      expect(shouldEscalate("elevated", "restricted")).toBe(false)
      expect(shouldEscalate("elevated", "standard")).toBe(false)
    })
  })

  describe("escalateBoundary", () => {
    it("escalates restricted to standard", () => {
      expect(escalateBoundary("restricted")).toBe("standard")
    })

    it("escalates standard to elevated", () => {
      expect(escalateBoundary("standard")).toBe("elevated")
    })

    it("returns elevated when already at elevated (ceiling)", () => {
      expect(escalateBoundary("elevated")).toBe("elevated")
    })
  })
})
