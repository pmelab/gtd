import { describe, expect, it } from "vitest"
import { buildPrompt } from "./Prompt.js"
import type { State } from "./State.js"

const baseState = (overrides: Partial<State>): State => ({
  branches: [],
  lastCommitSubject: "chore: init",
  diff: "",
  workingTreeClean: true,
  ...overrides,
})

describe("buildPrompt", () => {
  it("includes the header for every state", () => {
    const out = buildPrompt(baseState({ branches: ["run-tests"] }))
    expect(out).toContain("You are an autonomous coding agent")
    expect(out).toContain("Conventional Commits")
  })

  it("emits the grill appendix only for planning branches", () => {
    const planning = buildPrompt(baseState({ branches: ["new-todo"], workingTreeClean: false }))
    expect(planning).toContain("grill-with-docs methodology")

    const building = buildPrompt(baseState({ branches: ["build"] }))
    expect(building).not.toContain("grill-with-docs methodology")
  })

  it("composes multiple branches in stable order", () => {
    const out = buildPrompt(
      baseState({
        branches: ["todo-markers", "code-changes"],
        workingTreeClean: false,
        diff: "diff --git a/x b/x\n",
      }),
    )
    const markersIdx = out.indexOf("Extract `TODO:` markers")
    const commitIdx = out.indexOf("Commit uncommitted code changes")
    expect(markersIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeGreaterThan(markersIdx)
  })

  it("embeds the diff when present", () => {
    const out = buildPrompt(
      baseState({
        branches: ["code-changes"],
        workingTreeClean: false,
        diff: "diff --git a/foo b/foo\n+hello\n",
      }),
    )
    expect(out).toContain("```diff")
    expect(out).toContain("+hello")
  })

  it("omits the diff block when the tree is clean", () => {
    const out = buildPrompt(baseState({ branches: ["run-tests"] }))
    expect(out).not.toContain("```diff")
  })
})
