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

  it("execute prompt renders its section, names the selected package, and inlines its tasks", () => {
    const out = buildPrompt(
      result("execute", {
        autoAdvance: true,
        context: {
          packages: [
            {
              name: "01-foo",
              tasks: ["01-task.md"],
              taskContents: [{ name: "01-task.md", content: "First task" }],
              hasCommitMsg: true,
            },
          ],
        },
      }),
    )
    expect(out).toContain("Execute one work package")
    expect(out).toContain("### Package: `01-foo/`")
    expect(out).toContain("01-task.md")
    expect(out).toContain("First task")
    expect(out).toContain("01-foo/COMMIT_MSG.md")
    expect(out).toContain("Re-run gtd immediately")
    expect(out).not.toContain("EXACTLY ONE package")
    expect(out).not.toContain("lowest-numbered")
    expect(out).not.toContain("marked with `<!-- simple -->`")
    // Verification is now done by the edge at the start of the next cycle,
    // not by an in-prompt testing subagent.
    expect(out).not.toContain("testing subagent")
    expect(out).not.toContain("Determine the test command")
  })

  it("execute prompt fences backtick-containing task content with a long-enough fence", () => {
    const out = buildPrompt(
      result("execute", {
        context: {
          packages: [
            {
              name: "01-foo",
              tasks: ["01-task.md"],
              taskContents: [
                { name: "01-task.md", content: "see ```block``` and - [ ] item" },
              ],
              hasCommitMsg: true,
            },
          ],
        },
      }),
    )
    expect(out).toContain("````\nsee ```block``` and - [ ] item\n````")
  })

  it("execute prompt handles a package with zero task files", () => {
    const out = buildPrompt(
      result("execute", {
        context: {
          packages: [
            { name: "01-foo", tasks: [], taskContents: [], hasCommitMsg: true },
          ],
        },
      }),
    )
    expect(out).toContain("### Package: `01-foo/`")
    expect(out).toContain("01-foo/COMMIT_MSG.md")
  })

  it("cleanup prompt renders its section and the auto-advance partial", () => {
    const out = buildPrompt(result("cleanup", { autoAdvance: true }))
    expect(out).toContain("Delete the empty `.gtd/` directory")
    expect(out).toContain("Re-run gtd immediately")
    expect(out).not.toContain("Execute one work package")
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

  it("close-review section renders the commit message prefix", () => {
    const out = buildPrompt(result("close-review", { autoAdvance: true }))
    expect(out).toContain("chore(gtd): close approved review for")
  })

  it("close-review instructs reading short-sha from REVIEW.md base marker", () => {
    const out = buildPrompt(
      result("close-review", {
        autoAdvance: true,
        context: { baseRef: "abc1234def" },
      }),
    )
    // baseRef is not surfaced by buildContext when refDiff is absent,
    // so the prompt must instruct reading from REVIEW.md's <!-- base: --> marker.
    expect(out).toContain("<!-- base:")
    expect(out).toContain("first 7 characters")
  })

  it("close-review includes the auto-advance partial when autoAdvance is true", () => {
    const out = buildPrompt(result("close-review", { autoAdvance: true }))
    expect(out).toContain("Re-run gtd immediately")
  })

  it("close-review does NOT contain another leaf's section", () => {
    const out = buildPrompt(result("close-review", { autoAdvance: true }))
    expect(out).not.toContain("Process Review Feedback")
  })

  it("fix-tests override emits the fix(gtd) instruction and fences the captured output", () => {
    const out = buildPrompt(result("human-review"), {
      kind: "fix-tests",
      testOutput: "FAIL src/x.test.ts\nexpected 1 got 2",
    })
    expect(out).toContain("fix(gtd):")
    // The captured output is embedded inside a ``` fenced block.
    expect(out).toContain("```\nFAIL src/x.test.ts\nexpected 1 got 2\n```")
  })

  it("fix-tests override does NOT include the normal human-review REVIEW.md instructions", () => {
    const out = buildPrompt(result("human-review"), {
      kind: "fix-tests",
      testOutput: "FAIL src/x.test.ts\nexpected 1 got 2",
    })
    expect(out).not.toContain("format REVIEW.md")
  })

  it("fix-tests override does NOT include the auto-advance partial", () => {
    const out = buildPrompt(result("human-review", { autoAdvance: true }), {
      kind: "fix-tests",
      testOutput: "boom",
    })
    expect(out).not.toContain("Re-run gtd immediately")
  })

  it("fix-tests override lengthens the fence when the output contains backticks", () => {
    const out = buildPrompt(result("human-review"), {
      kind: "fix-tests",
      testOutput: "see `code` and ```block``` here",
    })
    expect(out).toContain("````\nsee `code` and ```block``` here\n````")
  })
})
