import { describe, expect, it } from "vitest"
import { buildPrompt } from "./Prompt.js"
import type { State } from "./State.js"

const baseState = (overrides: Partial<State>): State => ({
  branches: [],
  lastCommitSubject: "chore: init",
  diff: "",
  workingTreeClean: true,
  packages: [],
  ...overrides,
})

describe("buildPrompt", () => {
  it("includes the header for every state", () => {
    const out = buildPrompt(baseState({ branches: ["verify"] }))
    expect(out).toContain("You are an autonomous coding agent")
  })

  it("new-todo prompt instructs to format TODO.md", () => {
    const out = buildPrompt(baseState({ branches: ["new-todo"] }))
    expect(out).toContain("format TODO.md")
  })

  it("modified-todo prompt instructs to format TODO.md", () => {
    const out = buildPrompt(
      baseState({
        branches: ["modified-todo"],
        workingTreeClean: false,
        diff: "diff --git a/TODO.md b/TODO.md\n+change\n",
      }),
    )
    expect(out).toContain("format TODO.md")
  })

  it("todo-markers prompt instructs to format TODO.md", () => {
    const out = buildPrompt(
      baseState({
        branches: ["todo-markers"],
        workingTreeClean: false,
        diff: "diff --git a/x.ts b/x.ts\n+// TODO: fix this\n",
      }),
    )
    expect(out).toContain("format TODO.md")
  })

  it("review-create prompt instructs to format REVIEW.md", () => {
    const out = buildPrompt(baseState({ branches: ["review-create"] }))
    expect(out).toContain("format REVIEW.md")
  })

  it("review-process prompt instructs to format TODO.md", () => {
    const out = buildPrompt(baseState({ branches: ["review-process"] }))
    expect(out).toContain("format TODO.md")
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
    const out = buildPrompt(baseState({ branches: ["verify"] }))
    expect(out).not.toContain("```diff")
  })
})
