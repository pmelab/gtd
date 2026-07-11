import { describe, expect, it } from "vitest"
import { buildPrompt, isPromptState } from "./Prompt.js"
import type { GtdPackageFact, GtdState, ResolveContext, Result } from "./Machine.js"

const ctx = (overrides: Partial<ResolveContext> = {}): ResolveContext => ({
  testFixCount: 0,
  reviewFixCount: 0,
  packages: [],
  feedbackContent: "",
  ...overrides,
})

const result = (
  state: GtdState,
  overrides: { context?: Partial<ResolveContext>; actor?: "human" | "agent" } = {},
): Result => ({
  state,
  actor: overrides.actor ?? "agent",
  pending: false,
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
  actor: "human" | "agent" = "agent",
): Result => result(state, { actor, context: { packages: [onePackage], ...context } })

const PLANNING_MODEL = "claude-opus-4-8"
const EXECUTION_MODEL = "claude-sonnet-4-8"

const PROMPT_STATES: ReadonlyArray<GtdState> = [
  "grilling",
  "grilled",
  "building",
  "fixing",
  "agentic-review",
  "review",
  "await-review",
  "squashing",
  "escalate",
  "idle",
  "health-fixing",
]

const EDGE_ONLY_STATES: ReadonlyArray<GtdState> = [
  "testing",
  "planning",
  "close-package",
  "done",
  "health-check",
]

describe("isPromptState", () => {
  it("matches exactly the pinned 11-state set", () => {
    for (const state of PROMPT_STATES) expect(isPromptState(state)).toBe(true)
    for (const state of EDGE_ONLY_STATES) expect(isPromptState(state)).toBe(false)
  })
})

describe("buildPrompt", () => {
  it("includes the shared header for agent-orchestration prompt states", () => {
    expect(buildPrompt(result("escalate", { actor: "human" }))).toContain(
      "You are an autonomous coding agent",
    )
    expect(buildPrompt(result("fixing"))).toContain("You are an autonomous coding agent")
  })

  it("idle addresses the human, not the agent persona", () => {
    const out = buildPrompt(result("idle", { actor: "human" }))
    expect(out).not.toContain("You are an autonomous coding agent")
  })

  describe("each prompt-bearing state renders its section", () => {
    it("grilling (agent) renders the grilling-agent section", () => {
      const out = buildPrompt(result("grilling", { actor: "agent" }))
      expect(out).toContain("Develop it into a concrete")
    })

    it("grilling (human) renders the grilling-answers section", () => {
      const out = buildPrompt(result("grilling", { actor: "human" }))
      expect(out).toContain("nothing for the agent to do")
    })

    it("grilled renders the decompose section", () => {
      const out = buildPrompt(result("grilled"))
      expect(out).toContain("Decompose it into an ordered set of")
    })

    it("building renders the building section", () => {
      const out = buildPrompt(withPackage("building"))
      expect(out).toContain("Build the package described below")
    })

    it("fixing renders the fixing section", () => {
      const out = buildPrompt(result("fixing"))
      expect(out).toContain("Spawn a **fix subagent**")
    })

    it("agentic-review renders the agentic-review section", () => {
      const out = buildPrompt(withPackage("agentic-review"))
      expect(out).toContain("Spawn a **reviewing subagent**")
    })

    it("review renders the review section", () => {
      const out = buildPrompt(result("review"))
      expect(out).toContain("help a human to review the changes")
    })

    it("await-review renders the await-review section", () => {
      const out = buildPrompt(result("await-review", { actor: "human" }))
      expect(out).toContain("REVIEW.md")
      expect(out).toMatch(/human\s+gate/)
    })

    it("squashing renders the squashing section", () => {
      const out = buildPrompt(result("squashing"))
      expect(out).toContain("conventional-commits")
    })

    it("escalate renders the escalate section", () => {
      const out = buildPrompt(result("escalate", { actor: "human" }))
      expect(out).toContain("was not able to fix all errors on its own")
    })

    it("idle renders the idle section", () => {
      const out = buildPrompt(result("idle", { actor: "human" }))
      expect(out).toContain("The repository is idle")
      expect(out).toContain("Nothing to do")
    })
  })

  describe("edge-only states throw", () => {
    for (const state of EDGE_ONLY_STATES) {
      it(`${state} throws instead of rendering`, () => {
        expect(() => buildPrompt(result(state))).toThrow(
          new RegExp(`State "${state}" is performed by the edge and must never reach buildPrompt`),
        )
      })
    }
  })

  describe("health states", () => {
    it("health-fixing renders the fixing section", () => {
      const out = buildPrompt(result("health-fixing"))
      expect(out).toContain("Spawn a **fix subagent**")
    })

    it("health-fixing injects the execution model", () => {
      const out = buildPrompt(result("health-fixing"))
      expect(out).toContain(EXECUTION_MODEL)
      expect(out).not.toContain("{{MODEL}}")
    })
  })

  describe("{{MODEL}} substitution", () => {
    it("grilled injects the planning model and leaves no {{MODEL}}", () => {
      const out = buildPrompt(result("grilled"))
      expect(out).toContain(PLANNING_MODEL)
      expect(out).not.toContain("{{MODEL}}")
    })

    it("review injects the planning model and leaves no {{MODEL}}", () => {
      const out = buildPrompt(result("review"))
      expect(out).toContain(PLANNING_MODEL)
      expect(out).not.toContain("{{MODEL}}")
    })

    it("grilling (agent) injects the planning model and leaves no {{MODEL}}", () => {
      const out = buildPrompt(result("grilling", { actor: "agent" }))
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
      const out = buildPrompt(result("fixing"))
      expect(out).toContain(EXECUTION_MODEL)
      expect(out).not.toContain("{{MODEL}}")
    })

    it("honors a custom resolveModel for the model-bearing states", () => {
      const custom = (s: string): string => `MODEL-FOR-${s}`
      expect(buildPrompt(result("grilling", { actor: "agent" }), custom)).toContain(
        "MODEL-FOR-grilling",
      )
      expect(buildPrompt(result("grilled"), custom)).toContain("MODEL-FOR-decompose")
      expect(buildPrompt(withPackage("building"), custom)).toContain("MODEL-FOR-building")
      expect(buildPrompt(result("fixing"), custom)).toContain("MODEL-FOR-fixing")
      expect(buildPrompt(withPackage("agentic-review"), custom)).toContain(
        "MODEL-FOR-agentic-review",
      )
      expect(buildPrompt(result("review"), custom)).toContain("MODEL-FOR-clean")
    })

    it("human-gated states carry no {{MODEL}} and no injected model", () => {
      const custom = (s: string): string => `SHOULD-NOT-APPEAR-${s}`
      for (const state of ["escalate", "idle", "await-review"] as const) {
        const out = buildPrompt(result(state, { actor: "human" }), custom)
        expect(out).not.toContain("{{MODEL}}")
        expect(out).not.toContain("SHOULD-NOT-APPEAR")
      }
    })
  })

  describe("tail contract", () => {
    it("plain agent prompts end with the exact turn-ending tail", () => {
      const cases: ReadonlyArray<Result> = [
        result("grilling", { actor: "agent" }),
        result("grilled"),
        withPackage("building"),
        result("fixing"),
        withPackage("agentic-review"),
        result("review"),
        result("squashing"),
        result("health-fixing"),
      ]
      const tail =
        "Finish your turn by running `gtd step-agent`. Then run `gtd next` and follow\n" +
        "its output — repeat this cycle as long as the output is addressed to you (the\n" +
        "agent); when it awaits the human, stop and hand off."
      for (const res of cases) {
        const out = buildPrompt(res)
        expect(out.trimEnd().endsWith(tail)).toBe(true)
      }
    })

    it("plain human prompts have no tail", () => {
      const cases: ReadonlyArray<Result> = [
        result("grilling", { actor: "human" }),
        result("await-review", { actor: "human" }),
        result("escalate", { actor: "human" }),
        result("idle", { actor: "human" }),
      ]
      for (const res of cases) {
        const out = buildPrompt(res)
        expect(out).not.toContain("Finish your turn by running")
        expect(out).not.toContain("gtd step-agent")
      }
    })

    it("--json output has no tail regardless of actor", () => {
      const agentOut = buildPrompt(result("grilled"), undefined, "json")
      expect(agentOut).not.toContain("Finish your turn by running")
      expect(agentOut).not.toContain("gtd step-agent")

      const humanOut = buildPrompt(result("await-review", { actor: "human" }), undefined, "json")
      expect(humanOut).not.toContain("Finish your turn by running")
    })
  })

  describe("no dead v1 marker/sentinel/auto-advance machinery", () => {
    const allPromptResults = (): ReadonlyArray<Result> => [
      result("grilling", { actor: "agent" }),
      result("grilling", { actor: "human" }),
      result("grilled"),
      withPackage("building"),
      result("fixing"),
      withPackage("agentic-review"),
      result("review"),
      result("await-review", { actor: "human" }),
      result("squashing"),
      result("escalate", { actor: "human" }),
      result("idle", { actor: "human" }),
      result("health-fixing"),
    ]

    it("never mentions the v1 marker, sentinel, or auto-advance/bare-gtd instructions", () => {
      for (const res of allPromptResults()) {
        for (const output of ["plain", "json"] as const) {
          const out = buildPrompt(res, undefined, output)
          expect(out).not.toContain("user answers here")
          expect(out).not.toContain("no open questions")
          expect(out).not.toContain("auto-advance")
          expect(out).not.toMatch(/\brun `gtd`\b/)
          expect(out).not.toMatch(/re-run gtd/i)
        }
      }
    })
  })

  describe("grilling-agent turnDiff inlining", () => {
    it("inlines context.turnDiff as a fenced diff with the reading rules when present", () => {
      const out = buildPrompt(
        result("grilling", {
          actor: "agent",
          context: { turnDiff: "diff --git a/x b/x\n+hello\n" },
        }),
      )
      expect(out).toContain("```diff")
      expect(out).toContain("+hello")
      expect(out).toContain("feedback, not finished work")
    })

    it("omits the diff block when turnDiff is absent", () => {
      const out = buildPrompt(result("grilling", { actor: "agent" }))
      expect(out).not.toContain("```diff")
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
        result("fixing", { context: { feedbackContent: "FAIL: expected 1 to equal 2\n" } }),
      )
      expect(out).toContain("### Feedback to address")
      expect(out).toContain("FAIL: expected 1 to equal 2")
    })

    it("fences backtick-bearing feedback with a long-enough fence", () => {
      const out = buildPrompt(
        result("fixing", { context: { feedbackContent: "see ```snippet``` here" } }),
      )
      expect(out).toContain("````\nsee ```snippet``` here\n````")
    })

    it("omits the Feedback block when feedbackContent is empty", () => {
      const out = buildPrompt(result("fixing"))
      expect(out).not.toContain("### Feedback to address")
    })

    it("mentions disputing feedback by emptying or deleting .gtd/FEEDBACK.md", () => {
      const out = buildPrompt(result("fixing"))
      expect(out).toMatch(/empty or delete\s+`\.gtd\/FEEDBACK\.md`/)
    })
  })

  describe("diff context", () => {
    it("review inlines refDiff under a review heading", () => {
      const out = buildPrompt(
        result("review", {
          context: { refDiff: "diff --git a/x b/x\n+hello\n", reviewBase: "abc1234" },
        }),
      )
      expect(out).toContain("Changes to review")
      expect(out).toContain("```diff")
      expect(out).toContain("+hello")
    })

    it("review prompt contains literal reviewBase hash", () => {
      const out = buildPrompt(
        result("review", {
          context: { refDiff: "diff --git a/y b/y\n+world\n", reviewBase: "abc1234def" },
        }),
      )
      expect(out).toContain("abc1234def")
    })

    it("squashing inlines squashDiff under a full-process heading", () => {
      const out = buildPrompt(
        result("squashing", {
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
          context: { squashDiff: "diff --git a/y b/y\n+world\n", squashBase: "abc1234def" },
        }),
      )
      expect(out).toContain("abc1234def")
    })
  })

  describe("json output mode", () => {
    it("json output never carries the agent-turn tail", () => {
      const out = buildPrompt(withPackage("building"), undefined, "json")
      expect(out).not.toContain("gtd step-agent")
    })

    for (const [label, res] of [
      ["grilling (agent)", result("grilling", { actor: "agent" })],
      ["grilling (human)", result("grilling", { actor: "human" })],
      ["grilled", result("grilled")],
      ["building", withPackage("building")],
      ["fixing", result("fixing")],
      ["agentic-review", withPackage("agentic-review")],
      ["review", result("review")],
      ["await-review", result("await-review", { actor: "human" })],
      ["squashing", result("squashing")],
      ["escalate", result("escalate", { actor: "human" })],
      ["idle", result("idle", { actor: "human" })],
    ] as const) {
      it(`${label} has no bare gtd command`, () => {
        const text = buildPrompt(res, undefined, "json")
        const stripped = text
          .replace(/gtd\(agent\):/g, "")
          .replace(/gtd\(human\):/g, "")
          .replace(/gtd:/g, "")
          .replace(/\.gtd/g, "")
          .replace(/gtd step-agent/g, "")
          .replace(/gtd step/g, "")
          .replace(/gtd next/g, "")
        expect(stripped).not.toMatch(/\bgtd\b/)
      })
    }
  })
})
