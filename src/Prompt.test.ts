import { describe, expect, it } from "vitest"
import { buildPrompt } from "./Prompt.js"
import type { GtdContext, LeafState, ResolveResult } from "./Machine.js"

const baseContext = (overrides: Partial<GtdContext> = {}): GtdContext => ({
  verifyIterations: 0,
  maxVerifyIterations: 5,
  noAgentHops: 0,
  lastAdvancedLeaf: null,
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

  it("review-process prompt instructs to format and commit TODO.md without git revert", () => {
    const out = buildPrompt(result("review-process", { autoAdvance: true }))
    expect(out).toContain("format TODO.md")
    expect(out).toContain("git add TODO.md")
    expect(out).not.toContain("git revert")
    expect(out).not.toContain("docs(review): record raw feedback")
    expect(out).not.toContain("chore(gtd): close approved review")
  })

  it("escalate prompt renders its section", () => {
    const out = buildPrompt(result("escalate"))
    expect(out).toContain("Escalate to the human")
  })

  it("escalate does NOT include the auto-advance partial when autoAdvance is false", () => {
    const out = buildPrompt(result("escalate", { autoAdvance: false }))
    expect(out).not.toContain("Re-run gtd immediately")
  })

  it("includes the auto-advance partial when autoAdvance is true", () => {
    const out = buildPrompt(result("verified", { autoAdvance: true }))
    expect(out).toContain("Re-run gtd immediately")
  })

  it("embeds the diff when present", () => {
    const out = buildPrompt(
      result("human-review", {
        context: {
          workingTreeClean: false,
          diff: "diff --git a/foo b/foo\n+hello\n",
        },
      }),
    )
    expect(out).toContain("```diff")
    expect(out).toContain("+hello")
  })

  it("action leaf cleanup throws when reaching buildPrompt", () => {
    expect(() => buildPrompt(result("cleanup"))).toThrow(/Action leaf "cleanup"/)
  })

  it("action leaf close-review throws when reaching buildPrompt", () => {
    expect(() => buildPrompt(result("close-review"))).toThrow(/Action leaf "close-review"/)
  })

  it("action leaf code-changes throws when reaching buildPrompt", () => {
    expect(() => buildPrompt(result("code-changes"))).toThrow(/Action leaf "code-changes"/)
  })

  it("human-review (green path) contains format REVIEW.md and no Test gate failed", () => {
    const out = buildPrompt(result("human-review"))
    expect(out).toContain("format REVIEW.md")
    expect(out).not.toContain("Test gate failed")
  })

  it("fix-tests override contains Test gate failed and the output, no format REVIEW.md", () => {
    const out = buildPrompt(result("human-review"), {
      kind: "fix-tests",
      testOutput: "Test gate failed: npm test exited 1",
    })
    expect(out).toContain("Test gate failed")
    expect(out).toContain("Test gate failed: npm test exited 1")
    expect(out).not.toContain("format REVIEW.md")
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

  it("execute prompt never injects the now-empty .gtd/ removal line (edge owns it now)", () => {
    const single = buildPrompt(
      result("execute", {
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
    // The edge's commitPending({ removeLastPackage }) removes `.gtd/`; the prompt
    // must no longer instruct the agent to do it (single- OR multi-package).
    expect(single).not.toContain("remove the now-empty `.gtd/` directory")
  })

  it("execute prompt for multiple packages does NOT instruct removing the .gtd/ directory", () => {
    const out = buildPrompt(
      result("execute", {
        context: {
          packages: [
            {
              name: "01-foo",
              tasks: ["01-task.md"],
              taskContents: [{ name: "01-task.md", content: "First task" }],
              hasCommitMsg: true,
            },
            {
              name: "02-bar",
              tasks: ["01-task.md"],
              taskContents: [{ name: "01-task.md", content: "Second task" }],
              hasCommitMsg: true,
            },
          ],
        },
      }),
    )
    expect(out).toContain("### Package: `01-foo/`")
    expect(out).not.toContain("remove the now-empty `.gtd/` directory")
  })

  it("execute prompt instructs writing the `execute` intent marker", () => {
    const out = buildPrompt(
      result("execute", {
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
    expect(out).toContain(".gtd-commit-intent")
  })

  it("execute prompt fences backtick-containing task content with a long-enough fence", () => {
    const out = buildPrompt(
      result("execute", {
        context: {
          packages: [
            {
              name: "01-foo",
              tasks: ["01-task.md"],
              taskContents: [{ name: "01-task.md", content: "see ```block``` and - [ ] item" }],
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
          packages: [{ name: "01-foo", tasks: [], taskContents: [], hasCommitMsg: true }],
        },
      }),
    )
    expect(out).toContain("### Package: `01-foo/`")
    expect(out).toContain("01-foo/COMMIT_MSG.md")
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

  describe("model injection", () => {
    const planningStates: ReadonlyArray<LeafState> = ["new-todo", "modified-todo", "decompose"]
    const executionStates: ReadonlyArray<LeafState> = ["execute", "execute-simple"]
    const subagentStates = [...planningStates, ...executionStates]

    for (const state of planningStates) {
      it(`${state} emits the built-in planning model by default`, () => {
        const out = buildPrompt(result(state, { autoAdvance: true }))
        expect(out).toContain("claude-opus-4-8")
        expect(out).not.toContain("{{MODEL}}")
      })
    }

    for (const state of executionStates) {
      it(`${state} emits the built-in execution model by default`, () => {
        const out = buildPrompt(
          result(state, {
            autoAdvance: true,
            context:
              state === "execute"
                ? {
                    packages: [
                      {
                        name: "01-foo",
                        tasks: ["01-task.md"],
                        taskContents: [{ name: "01-task.md", content: "First task" }],
                        hasCommitMsg: true,
                      },
                    ],
                  }
                : {},
          }),
        )
        expect(out).toContain("claude-sonnet-4-8")
        expect(out).not.toContain("{{MODEL}}")
      })
    }

    for (const state of subagentStates) {
      it(`${state} honors a custom resolveModel`, () => {
        const out = buildPrompt(
          result(state, {
            autoAdvance: true,
            context:
              state === "execute"
                ? {
                    packages: [
                      {
                        name: "01-foo",
                        tasks: ["01-task.md"],
                        taskContents: [{ name: "01-task.md", content: "First task" }],
                        hasCommitMsg: true,
                      },
                    ],
                  }
                : {},
          }),
          undefined,
          (s) => `MODEL-FOR-${s}`,
        )
        expect(out).toContain(`MODEL-FOR-${state}`)
        expect(out).not.toContain("{{MODEL}}")
      })
    }

    it("a per-state override beats its tier default", () => {
      const out = buildPrompt(result("execute-simple", { autoAdvance: true }), undefined, (s) =>
        s === "execute-simple" ? "custom-simple-model" : "claude-sonnet-4-8",
      )
      expect(out).toContain("custom-simple-model")
      expect(out).not.toContain("claude-sonnet-4-8")
    })

    it("the five subagent prompts no longer carry the AGENTS.md model-preference prose", () => {
      for (const state of subagentStates) {
        const out = buildPrompt(
          result(state, {
            context:
              state === "execute"
                ? {
                    packages: [
                      {
                        name: "01-foo",
                        tasks: ["01-task.md"],
                        taskContents: [{ name: "01-task.md", content: "First task" }],
                        hasCommitMsg: true,
                      },
                    ],
                  }
                : {},
          }),
        )
        expect(out).not.toContain("AGENTS.md for model preferences")
      }
    })

    it("the dropped header prose is gone", () => {
      const out = buildPrompt(result("verified"))
      expect(out).not.toContain("AGENTS.md for model preferences")
      expect(out).not.toContain("Check your user/project AGENTS.md")
    })

    it("review-incomplete prompt renders its section and does NOT leak another leaf's section", () => {
      const out = buildPrompt(result("review-incomplete", { autoAdvance: false }))
      expect(out).toContain("at least one checkbox is still unticked")
      expect(out).toContain("STOP")
      // Must not leak the await-review section
      expect(out).not.toContain("has not recorded any feedback")
      // Must not include auto-advance
      expect(out).not.toContain("Re-run gtd immediately")
    })

    it("review-process override renders the section, fences the diff, includes auto-advance, and surfaces recordSha", () => {
      const out = buildPrompt(result("review-process", { autoAdvance: true }), {
        kind: "review-process",
        reviewDiff: "diff --git a/x b/x\n+hi\n",
        recordSha: "deadbee",
      })
      // Section rendered
      expect(out).toContain("format TODO.md")
      expect(out).toContain("git add TODO.md")
      // No git revert in the slim prompt
      expect(out).not.toContain("git revert")
      // Fenced diff
      expect(out).toContain("### Review feedback diff")
      expect(out).toContain("```\ndiff --git a/x b/x\n+hi\n```")
      // auto-advance partial
      expect(out).toContain("Re-run gtd immediately")
      // recovery hint with recordSha
      expect(out).toContain("deadbee")
      expect(out).toContain("git show deadbee")
    })

    it("review-process override lengthens the fence when diff contains backticks", () => {
      const out = buildPrompt(result("review-process", { autoAdvance: true }), {
        kind: "review-process",
        reviewDiff: "see `code` and ```block``` here",
        recordSha: "abc1234",
      })
      expect(out).toContain("````\nsee `code` and ```block``` here\n````")
    })

    it("fix-tests override carries no injected model and no {{MODEL}} leak", () => {
      const out = buildPrompt(
        result("execute"),
        { kind: "fix-tests", testOutput: "boom" },
        () => "SHOULD-NOT-APPEAR",
      )
      expect(out).not.toContain("{{MODEL}}")
      expect(out).not.toContain("SHOULD-NOT-APPEAR")
    })
  })
})
