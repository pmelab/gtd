import { describe, expect, it } from "vitest"
import { buildPrompt } from "./Prompt.js"
import type { GtdPackageFact, GtdState, ResolveContext, Result } from "./Machine.js"

const ctx = (overrides: Partial<ResolveContext> = {}): ResolveContext => ({
  testFixCount: 0,
  reviewFixCount: 0,
  packages: [],
  diff: "",
  lastCommitSubject: "chore: init",
  workingTreeClean: true,
  feedbackContent: "",
  ...overrides,
})

const result = (
  state: GtdState,
  overrides: { context?: Partial<ResolveContext>; autoAdvance?: boolean } = {},
): Result => ({
  state,
  autoAdvance: overrides.autoAdvance ?? false,
  context: ctx(overrides.context),
})

const onePackage: GtdPackageFact = {
  name: "01-foo",
  tasks: ["01-task.md"],
  taskContents: [{ name: "01-task.md", content: "Acceptance criterion A" }],
}

const withPackage = (
  state: GtdState,
  context: Partial<ResolveContext> = {},
  autoAdvance = true,
): Result => result(state, { autoAdvance, context: { packages: [onePackage], ...context } })

const PLANNING_MODEL = "claude-opus-4-8"
const EXECUTION_MODEL = "claude-sonnet-4-8"

describe("buildPrompt", () => {
  it("includes the shared header for every prompt state", () => {
    expect(buildPrompt(result("idle"))).toContain("You are an autonomous coding agent")
    expect(buildPrompt(result("escalate"))).toContain("You are an autonomous coding agent")
  })

  describe("each prompt-bearing state renders its section", () => {
    it("grilling renders the grilling section", () => {
      const out = buildPrompt(
        result("grilling", { autoAdvance: true, context: { grillingCase: "iterate" } }),
      )
      expect(out).toContain("holds the plan under development")
    })

    it("grilled renders the decompose section", () => {
      const out = buildPrompt(result("grilled", { autoAdvance: true }))
      expect(out).toContain("Decompose it into an ordered set of")
    })

    it("planning renders the decompose section", () => {
      const out = buildPrompt(result("planning", { autoAdvance: true }))
      expect(out).toContain("Decompose it into an ordered set of")
    })

    it("building renders the building section", () => {
      const out = buildPrompt(withPackage("building"))
      expect(out).toContain("Build the package described below")
    })

    it("fixing renders the fixing section", () => {
      const out = buildPrompt(result("fixing", { autoAdvance: true }))
      expect(out).toContain("Spawn a **fix subagent**")
    })

    it("agentic-review renders the agentic-review section", () => {
      const out = buildPrompt(withPackage("agentic-review"))
      expect(out).toContain("Spawn a **reviewing subagent**")
    })

    it("clean renders the clean section", () => {
      const out = buildPrompt(result("clean"))
      expect(out).toContain("help a human to review the changes")
    })

    it("squashing renders the squashing section", () => {
      const out = buildPrompt(result("squashing"))
      expect(out).toContain("conventional-commits squash message")
    })

    it("escalate renders the escalate section", () => {
      const out = buildPrompt(result("escalate"))
      expect(out).toContain("was not able to fix all errors on its own")
    })

    it("idle renders the idle section", () => {
      const out = buildPrompt(result("idle"))
      expect(out).toContain("repository is idle — nothing to do")
    })

    it("grilled-review renders the human review gate section", () => {
      const out = buildPrompt(result("grilled-review", { autoAdvance: false }))
      expect(out).toContain("Human review gate")
    })

    it("grilled-review does NOT contain the decompose text", () => {
      const out = buildPrompt(result("grilled-review", { autoAdvance: false }))
      expect(out).not.toContain("Decompose it into an ordered set of")
    })
  })

  describe("edge-only states throw", () => {
    const edgeOnly: ReadonlyArray<GtdState> = [
      "transport",
      "new-feature",
      "testing",
      "accept-review",
      "close-package",
      "done",
      "await-review",
    ]
    for (const state of edgeOnly) {
      it(`${state} throws instead of rendering`, () => {
        expect(() => buildPrompt(result(state))).toThrow(
          new RegExp(`State "${state}" is performed by the edge and must never reach buildPrompt`),
        )
      })
    }
  })

  describe("{{MODEL}} substitution", () => {
    const planningStates: ReadonlyArray<GtdState> = ["grilled", "planning", "clean"]
    for (const state of planningStates) {
      it(`${state} injects the planning model and leaves no {{MODEL}}`, () => {
        const out = buildPrompt(result(state, { autoAdvance: true }))
        expect(out).toContain(PLANNING_MODEL)
        expect(out).not.toContain("{{MODEL}}")
      })
    }

    it("grilling (iterate) injects the planning model and leaves no {{MODEL}}", () => {
      const out = buildPrompt(
        result("grilling", { autoAdvance: true, context: { grillingCase: "iterate" } }),
      )
      expect(out).toContain(PLANNING_MODEL)
      expect(out).not.toContain("{{MODEL}}")
    })

    it("agentic-review injects the planning model and leaves no {{MODEL}}", () => {
      const out = buildPrompt(withPackage("agentic-review"))
      expect(out).toContain(PLANNING_MODEL)
      expect(out).not.toContain("{{MODEL}}")
    })

    it("building injects the execution model and leaves no {{MODEL}}", () => {
      const out = buildPrompt(withPackage("building"))
      expect(out).toContain(EXECUTION_MODEL)
      expect(out).not.toContain("{{MODEL}}")
    })

    it("fixing injects the execution model and leaves no {{MODEL}}", () => {
      const out = buildPrompt(result("fixing", { autoAdvance: true }))
      expect(out).toContain(EXECUTION_MODEL)
      expect(out).not.toContain("{{MODEL}}")
    })

    it("honors a custom resolveModel for the six model states", () => {
      const custom = (s: string): string => `MODEL-FOR-${s}`
      expect(
        buildPrompt(
          result("grilling", { autoAdvance: true, context: { grillingCase: "iterate" } }),
          custom,
        ),
      ).toContain("MODEL-FOR-grilling")
      expect(buildPrompt(result("grilled", { autoAdvance: true }), custom)).toContain(
        "MODEL-FOR-decompose",
      )
      expect(buildPrompt(result("planning", { autoAdvance: true }), custom)).toContain(
        "MODEL-FOR-decompose",
      )
      expect(buildPrompt(withPackage("building"), custom)).toContain("MODEL-FOR-building")
      expect(buildPrompt(result("fixing", { autoAdvance: true }), custom)).toContain(
        "MODEL-FOR-fixing",
      )
      expect(buildPrompt(withPackage("agentic-review"), custom)).toContain(
        "MODEL-FOR-agentic-review",
      )
      expect(buildPrompt(result("clean"), custom)).toContain("MODEL-FOR-clean")
    })

    it("STOP states carry no {{MODEL}} and no injected model", () => {
      const custom = (s: string): string => `SHOULD-NOT-APPEAR-${s}`
      for (const state of ["escalate", "idle", "grilled-review"] as const) {
        const out = buildPrompt(result(state), custom)
        expect(out).not.toContain("{{MODEL}}")
        expect(out).not.toContain("SHOULD-NOT-APPEAR")
      }
    })
  })

  describe("STOP banner", () => {
    it("escalate leads with the STOP banner", () => {
      const out = buildPrompt(result("escalate"))
      expect(out).toContain("This is a human feedback gate")
      expect(out.indexOf("This is a human feedback gate")).toBeGreaterThan(
        out.indexOf("was not able to fix all errors on its own"),
      )
    })

    it("idle leads with the STOP banner", () => {
      const out = buildPrompt(result("idle"))
      expect(out).toContain("This is a human feedback gate")
      expect(out.indexOf("This is a human feedback gate")).toBeGreaterThan(
        out.indexOf("repository is idle — nothing to do"),
      )
    })

    it("grilling stop-case leads with the STOP banner", () => {
      const out = buildPrompt(
        result("grilling", { autoAdvance: false, context: { grillingCase: "stop" } }),
      )
      expect(out).toContain("This is a human feedback gate")
      expect(out.indexOf("This is a human feedback gate")).toBeGreaterThan(
        out.indexOf("Open questions await the user"),
      )
    })

    it("clean gets the STOP banner", () => {
      const out = buildPrompt(result("clean"))
      expect(out).toContain("This is a human feedback gate")
    })

    it("grilled-review gets the STOP banner", () => {
      const out = buildPrompt(result("grilled-review", { autoAdvance: false }))
      expect(out).toContain("This is a human feedback gate")
    })

    it("auto-advance states do NOT get the STOP banner", () => {
      for (const out of [
        buildPrompt(result("grilled", { autoAdvance: true })),
        buildPrompt(result("planning", { autoAdvance: true })),
        buildPrompt(withPackage("building")),
        buildPrompt(result("fixing", { autoAdvance: true })),
        buildPrompt(withPackage("agentic-review")),
        buildPrompt(
          result("grilling", { autoAdvance: true, context: { grillingCase: "iterate" } }),
        ),
      ]) {
        expect(out).not.toContain("This is a human feedback gate")
        expect(out).toContain("run `gtd`")
      }
    })
  })

  describe("grilling stop vs iterate tail", () => {
    it("both tails document the convergence marker and the sentinel", () => {
      for (const grillingCase of ["stop", "iterate"] as const) {
        const out = buildPrompt(
          result("grilling", {
            autoAdvance: grillingCase === "iterate",
            context: { grillingCase },
          }),
        )
        expect(out).toContain("<!-- user answers here -->")
        expect(out).toContain("no open questions — ready to plan")
      }
    })

    it("stop tail is a human gate: STOP, no subagent, no auto-advance, no model", () => {
      const out = buildPrompt(
        result("grilling", { autoAdvance: false, context: { grillingCase: "stop" } }),
      )
      expect(out).toContain("Open questions await the user")
      expect(out).toContain("This is a human feedback gate")
      expect(out).not.toContain("Re-run gtd immediately")
      expect(out).not.toContain(PLANNING_MODEL)
      expect(out).not.toContain("Develop the plan")
    })

    it("iterate tail develops the plan with a subagent and auto-advances", () => {
      const out = buildPrompt(
        result("grilling", { autoAdvance: true, context: { grillingCase: "iterate" } }),
      )
      expect(out).toContain("Develop the plan")
      expect(out).toContain(PLANNING_MODEL)
      expect(out).toContain("run `gtd`")
      expect(out).not.toContain("Open questions await the user")
    })
  })

  describe("package rendering", () => {
    const richPackage: GtdPackageFact = {
      name: "01-foo",
      tasks: ["01-task.md", "02-task.md"],
      taskContents: [
        { name: "01-task.md", content: "First task" },
        { name: "02-task.md", content: "see ```block``` and - [ ] item" },
      ],
    }

    it("building inlines the selected package's tasks with no COMMIT_MSG reference", () => {
      const out = buildPrompt(withPackage("building", { packages: [richPackage] }))
      expect(out).toContain("### Package: `01-foo/`")
      expect(out).toContain("#### `01-task.md`")
      expect(out).toContain("First task")
      expect(out).not.toContain("COMMIT_MSG")
    })

    it("agentic-review inlines the package and shows the package diff, no COMMIT_MSG", () => {
      const out = buildPrompt(
        withPackage("agentic-review", {
          packages: [richPackage],
          refDiff: "diff --git a/src/foo.ts b/src/foo.ts\n+export const foo = 1\n",
          reviewBase: "deadbee",
        }),
      )
      expect(out).toContain("### Package: `01-foo/`")
      expect(out).toContain("### Package diff")
      expect(out).toContain("+export const foo = 1")
      expect(out).not.toContain("COMMIT_MSG")
    })

    it("fences backtick-bearing task content with a long-enough fence", () => {
      const out = buildPrompt(withPackage("building", { packages: [richPackage] }))
      expect(out).toContain("````\nsee ```block``` and - [ ] item\n````")
    })

    it("handles a package with zero task files", () => {
      const empty: GtdPackageFact = { name: "01-foo", tasks: [], taskContents: [] }
      const out = buildPrompt(withPackage("building", { packages: [empty] }))
      expect(out).toContain("### Package: `01-foo/`")
    })
  })

  describe("fixing feedback inlining", () => {
    it("inlines the feedbackContent under a heading so the fixer needn't read FEEDBACK.md", () => {
      const out = buildPrompt(
        result("fixing", {
          autoAdvance: true,
          context: { feedbackContent: "FAIL: expected 1 to equal 2\n" },
        }),
      )
      expect(out).toContain("### Feedback to address")
      expect(out).toContain("FAIL: expected 1 to equal 2")
    })

    it("fences backtick-bearing feedback with a long-enough fence", () => {
      const out = buildPrompt(
        result("fixing", {
          autoAdvance: true,
          context: { feedbackContent: "see ```snippet``` here" },
        }),
      )
      expect(out).toContain("````\nsee ```snippet``` here\n````")
    })

    it("omits the Feedback block when feedbackContent is empty", () => {
      const out = buildPrompt(result("fixing", { autoAdvance: true }))
      expect(out).not.toContain("### Feedback to address")
    })
  })

  describe("diff context", () => {
    it("clean inlines refDiff under a review heading", () => {
      const out = buildPrompt(
        result("clean", {
          context: { refDiff: "diff --git a/x b/x\n+hello\n", reviewBase: "abc1234" },
        }),
      )
      expect(out).toContain("Changes to review")
      expect(out).toContain("```diff")
      expect(out).toContain("+hello")
    })

    it("clean prompt contains literal reviewBase hash", () => {
      const out = buildPrompt(
        result("clean", {
          context: { refDiff: "diff --git a/y b/y\n+world\n", reviewBase: "abc1234def" },
        }),
      )
      expect(out).toContain("abc1234def")
    })

    it("squashing inlines squashDiff under a full-process heading", () => {
      const out = buildPrompt(
        result("squashing", {
          autoAdvance: true,
          context: { squashDiff: "diff --git a/x b/x\n+hello\n", squashBase: "abc1234" },
        }),
      )
      expect(out).toContain("Full-process diff")
      expect(out).toContain("```diff")
      expect(out).toContain("+hello")
    })

    it("squashing prompt contains literal squashBase hash", () => {
      const out = buildPrompt(
        result("squashing", {
          autoAdvance: true,
          context: { squashDiff: "diff --git a/y b/y\n+world\n", squashBase: "abc1234def" },
        }),
      )
      expect(out).toContain("abc1234def")
    })

    it("squashing with autoAdvance includes auto-advance tail and no STOP tail", () => {
      const out = buildPrompt(
        result("squashing", {
          autoAdvance: true,
          context: { squashDiff: "diff --git a/x b/x\n+hello\n", squashBase: "abc1234" },
        }),
      )
      expect(out).toContain("run `gtd`")
      expect(out).not.toContain("This is a human feedback gate")
    })

    it("squashing includes git reset --soft instruction", () => {
      const out = buildPrompt(
        result("squashing", {
          autoAdvance: true,
          context: { squashDiff: "diff --git a/x b/x\n+hello\n", squashBase: "abc1234" },
        }),
      )
      expect(out).toContain("git reset --soft")
    })

    it("renders the working-tree diff in Context when present", () => {
      const out = buildPrompt(
        result("fixing", {
          autoAdvance: true,
          context: { workingTreeClean: false, diff: "diff --git a/foo b/foo\n+changed\n" },
        }),
      )
      expect(out).toContain("Working-tree diff")
      expect(out).toContain("+changed")
    })

    it("omits the diff block when there is no diff", () => {
      const out = buildPrompt(result("idle"))
      expect(out).not.toContain("```diff")
    })
  })

  describe("json output mode", () => {
    const NEUTRAL = "Complete the tasks above, then end your turn. An outside process will decide"

    describe("tail swap", () => {
      it("auto-advance state gets neutral line, not ## Auto-advance or STOP banner", () => {
        const out = buildPrompt(withPackage("building"), undefined, "json")
        expect(out).toContain(NEUTRAL)
        expect(out).not.toContain("## Auto-advance")
        expect(out).not.toContain("This is a human feedback gate")
      })

      it("STOP state gets neutral line, not STOP banner", () => {
        const out = buildPrompt(result("escalate"), undefined, "json")
        expect(out).toContain(NEUTRAL)
        expect(out).not.toContain("This is a human feedback gate")
      })

      it("plain auto-advance state still has ## Auto-advance", () => {
        const out = buildPrompt(withPackage("building"))
        expect(out).toContain("run `gtd`")
        expect(out).not.toContain("This is a human feedback gate")
      })

      it("plain STOP state still has STOP banner", () => {
        const out = buildPrompt(result("escalate"))
        expect(out).toContain("This is a human feedback gate")
        expect(out).not.toContain("## Auto-advance")
      })
    })

    describe("no bare gtd command in any prompt-bearing state", () => {
      const cases: ReadonlyArray<[string, Result]> = [
        [
          "grilling (iterate)",
          result("grilling", { autoAdvance: true, context: { grillingCase: "iterate" } }),
        ],
        [
          "grilling (stop)",
          result("grilling", { autoAdvance: false, context: { grillingCase: "stop" } }),
        ],
        ["grilled", result("grilled", { autoAdvance: true })],
        ["building", withPackage("building")],
        ["fixing", result("fixing", { autoAdvance: true })],
        ["agentic-review", withPackage("agentic-review")],
        ["clean", result("clean")],
        ["squashing", result("squashing", { autoAdvance: true })],
        ["escalate", result("escalate")],
        ["idle", result("idle")],
        ["grilled-review", result("grilled-review", { autoAdvance: false })],
      ]

      for (const [label, res] of cases) {
        it(`${label} has no bare gtd command`, () => {
          const text = buildPrompt(res, undefined, "json")
          const stripped = text.replace(/gtd:/g, "").replace(/\.gtd/g, "")
          expect(stripped).not.toMatch(/\bgtd\b/)
        })
      }
    })
  })

  describe("auto-advance partial", () => {
    it("is appended when result.autoAdvance is true", () => {
      expect(buildPrompt(result("grilled", { autoAdvance: true }))).toContain("run `gtd`")
    })

    it("is omitted when result.autoAdvance is false", () => {
      expect(buildPrompt(result("escalate", { autoAdvance: false }))).not.toContain(
        "Re-run gtd immediately",
      )
      expect(buildPrompt(result("idle"))).not.toContain("Re-run gtd immediately")
    })

    it("clean is not-auto-advance and carries a STOP directive", () => {
      const out = buildPrompt(result("clean"))
      expect(out).not.toContain("Re-run gtd immediately")
      expect(out).toContain("This is a human feedback gate")
    })
  })
})
