import { describe, it, expect } from "@effect/vitest"
import {
  HUMAN,
  PLAN,
  BUILD,
  LEARN,
  CLEANUP,
  SEED,
  FEEDBACK,
  EXPLORE,
  parseCommitPrefix,
} from "./CommitPrefix.js"

describe("CommitPrefix", () => {
  describe("constants", () => {
    it("HUMAN is 🤦", () => {
      expect(HUMAN).toBe("🤦")
    })
    it("PLAN is 🤖", () => {
      expect(PLAN).toBe("🤖")
    })
    it("BUILD is 🔨", () => {
      expect(BUILD).toBe("🔨")
    })
    it("LEARN is 🎓", () => {
      expect(LEARN).toBe("🎓")
    })
    it("CLEANUP is 🧹", () => {
      expect(CLEANUP).toBe("🧹")
    })
    it("SEED is 🌱", () => {
      expect(SEED).toBe("🌱")
    })
    it("FEEDBACK is 💬", () => {
      expect(FEEDBACK).toBe("💬")
    })
    it("EXPLORE is 🧭", () => {
      expect(EXPLORE).toBe("🧭")
    })
  })

  describe("parseCommitPrefix", () => {
    it("parses HUMAN prefix", () => {
      expect(parseCommitPrefix("🤦 some message")).toBe(HUMAN)
    })
    it("parses PLAN prefix", () => {
      expect(parseCommitPrefix("🤖 plan something")).toBe(PLAN)
    })
    it("parses BUILD prefix", () => {
      expect(parseCommitPrefix("🔨 build something")).toBe(BUILD)
    })
    it("parses LEARN prefix", () => {
      expect(parseCommitPrefix("🎓 learned something")).toBe(LEARN)
    })
    it("parses CLEANUP prefix", () => {
      expect(parseCommitPrefix("🧹 cleanup something")).toBe(CLEANUP)
    })
    it("parses SEED prefix", () => {
      expect(parseCommitPrefix("🌱 create TODO")).toBe(SEED)
    })
    it("parses FEEDBACK prefix", () => {
      expect(parseCommitPrefix("💬 add review notes")).toBe(FEEDBACK)
    })
    it("parses EXPLORE prefix", () => {
      expect(parseCommitPrefix("🧭 explore options")).toBe(EXPLORE)
    })
    it("parse round-trip for EXPLORE", () => {
      expect(parseCommitPrefix(`${EXPLORE} some message`)).toBe(EXPLORE)
    })
    it("returns undefined for unknown emoji", () => {
      expect(parseCommitPrefix("🚀 launch")).toBeUndefined()
    })
    it("returns undefined for no emoji", () => {
      expect(parseCommitPrefix("just a message")).toBeUndefined()
    })
    it("returns undefined for empty string", () => {
      expect(parseCommitPrefix("")).toBeUndefined()
    })
  })
})
