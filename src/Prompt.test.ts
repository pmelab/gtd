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
  })

  it("composes multiple branches in stable order", () => {
    const out = buildPrompt(
      baseState({
        branches: ["todo-markers", "code-changes"],
        workingTreeClean: false,
        diff: "diff --git a/x b/x\n",
      }),
    )
    const markersIdx = out.indexOf("Move `TODO:` markers")
    const commitIdx = out.indexOf("Commit the uncommitted changes")
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
