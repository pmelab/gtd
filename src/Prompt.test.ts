import { describe, expect, it } from "vitest"
import { buildPrompt } from "./Prompt.js"
import type { GtdContext, LeafState, ResolveResult } from "./Machine.js"

const baseContext = (overrides: Partial<GtdContext> = {}): GtdContext => ({
  verifyIterations: 0,
  maxVerifyIterations: 5,
  lastCommitSubject: "chore: init",
  workingTreeClean: true,
  packages: [],
  diff: "",
  ...overrides,
})

const result = (
  value: LeafState,
  overrides: {
    context?: Partial<GtdContext>
    autoAdvance?: boolean
  } = {},
): ResolveResult => ({
  value,
  context: baseContext(overrides.context),
  autoAdvance: overrides.autoAdvance ?? false,
})

describe("buildPrompt", () => {
  it("includes the header for every state", () => {
    const out = buildPrompt(result("verified"))
    expect(out).toContain("You are an autonomous coding agent")
  })

  it("new-todo prompt instructs to format TODO.md", () => {
    const out = buildPrompt(result("new-todo", { autoAdvance: true }))
    expect(out).toContain("format TODO.md")
  })

  it("modified-todo prompt instructs to format TODO.md", () => {
    const out = buildPrompt(
      result("modified-todo", {
        autoAdvance: true,
        context: {
          workingTreeClean: false,
          diff: "diff --git a/TODO.md b/TODO.md\n+change\n",
        },
      }),
    )
    expect(out).toContain("format TODO.md")
  })

  it("human-review prompt instructs to format REVIEW.md and embeds the base marker", () => {
    const out = buildPrompt(result("human-review"))
    expect(out).toContain("format REVIEW.md")
    expect(out).toContain("<!-- base: <full-hash> -->")
  })

  it("review-process prompt instructs to format TODO.md and pull TODO: markers", () => {
    const out = buildPrompt(result("review-process", { autoAdvance: true }))
    expect(out).toContain("format TODO.md")
    expect(out).toContain("TODO:")
  })

  it("renders exactly one section for the resolved value", () => {
    const out = buildPrompt(
      result("code-changes", {
        autoAdvance: true,
        context: { workingTreeClean: false, diff: "diff --git a/x b/x\n" },
      }),
    )
    expect(out).toContain("Commit the uncommitted changes")
    // The review-process section must NOT leak in.
    expect(out).not.toContain("Process Review Feedback")
  })

  it("escalate prompt renders its section", () => {
    const out = buildPrompt(result("escalate"))
    expect(out).toContain("fix(gtd):")
  })

  it("escalate does NOT include the auto-advance partial when autoAdvance is false", () => {
    const out = buildPrompt(result("escalate", { autoAdvance: false }))
    expect(out).not.toContain("Re-run gtd immediately")
  })

  it("includes the auto-advance partial when autoAdvance is true", () => {
    const out = buildPrompt(result("code-changes", { autoAdvance: true }))
    expect(out).toContain("Re-run gtd immediately")
  })

  it("embeds the diff when present", () => {
    const out = buildPrompt(
      result("code-changes", {
        autoAdvance: true,
        context: {
          workingTreeClean: false,
          diff: "diff --git a/foo b/foo\n+hello\n",
        },
      }),
    )
    expect(out).toContain("```diff")
    expect(out).toContain("+hello")
  })

  it("omits the diff block when the tree is clean", () => {
    const out = buildPrompt(result("verified"))
    expect(out).not.toContain("```diff")
  })

  it("execute prompt renders its section and the auto-advance partial", () => {
    const out = buildPrompt(result("execute", { autoAdvance: true }))
    expect(out).toContain("Execute all work packages")
    expect(out).toContain("Re-run gtd immediately")
    expect(out).not.toContain("marked with `<!-- simple -->`")
  })

  it("cleanup prompt renders its section and the auto-advance partial", () => {
    const out = buildPrompt(result("cleanup", { autoAdvance: true }))
    expect(out).toContain("Delete the empty `.gtd/` directory")
    expect(out).toContain("Re-run gtd immediately")
    expect(out).not.toContain("Execute all work packages")
  })

  it("decompose prompt renders its section and the auto-advance partial", () => {
    const out = buildPrompt(result("decompose", { autoAdvance: true }))
    expect(out).toContain("Decompose `TODO.md` into work packages")
    expect(out).toContain("Re-run gtd immediately")
    expect(out).not.toContain("Delete the empty `.gtd/` directory")
  })

  it("execute-simple prompt renders its section and the auto-advance partial", () => {
    const out = buildPrompt(result("execute-simple", { autoAdvance: true }))
    expect(out).toContain("marked with `<!-- simple -->`")
    expect(out).toContain("Re-run gtd immediately")
    expect(out).not.toContain("Decompose `TODO.md` into work packages")
  })
})
