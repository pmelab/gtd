import { describe, expect, it } from "vitest"
import { buildPrompt } from "./Prompt.js"
import type { GtdPackageFact, GtdState, ResolveContext, Result } from "./Machine.js"

// Fixed resolver so snapshots are independent of Config.ts defaults
const resolveModel = (s: string): string => `MODEL-${s}`

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

const richPackage: GtdPackageFact = {
  name: "01-foo",
  tasks: ["01-task.md", "02-task.md"],
  taskContents: [
    { name: "01-task.md", content: "First task" },
    { name: "02-task.md", content: "see ```block``` and - [ ] item" },
  ],
}

const withPackage = (
  state: GtdState,
  context: Partial<ResolveContext> = {},
  actor: "human" | "agent" = "agent",
): Result => result(state, { actor, context: { packages: [onePackage], ...context } })

describe("buildPrompt snapshots", () => {
  // ── human-gated states (no model) ───────────────────────────────────────

  it("idle plain", () => {
    expect(buildPrompt(result("idle", { actor: "human" }), resolveModel, "plain")).toMatchSnapshot()
  })

  it("idle json", () => {
    expect(buildPrompt(result("idle", { actor: "human" }), resolveModel, "json")).toMatchSnapshot()
  })

  it("escalate plain", () => {
    expect(
      buildPrompt(result("escalate", { actor: "human" }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("escalate json", () => {
    expect(
      buildPrompt(result("escalate", { actor: "human" }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  it("await-review plain", () => {
    expect(
      buildPrompt(result("await-review", { actor: "human" }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("await-review json", () => {
    expect(
      buildPrompt(result("await-review", { actor: "human" }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  // ── grilling ─────────────────────────────────────────────────────────────

  it("grilling agent plain", () => {
    expect(
      buildPrompt(result("grilling", { actor: "agent" }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("grilling agent json", () => {
    expect(
      buildPrompt(result("grilling", { actor: "agent" }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  it("grilling agent with turnDiff plain", () => {
    expect(
      buildPrompt(
        result("grilling", {
          actor: "agent",
          context: { turnDiff: "diff --git a/TODO.md b/TODO.md\n+- answer: use option A\n" },
        }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("grilling human plain", () => {
    expect(
      buildPrompt(result("grilling", { actor: "human" }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("grilling human json", () => {
    expect(
      buildPrompt(result("grilling", { actor: "human" }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  // ── architecting ─────────────────────────────────────────────────────────

  it("architecting agent plain", () => {
    expect(
      buildPrompt(result("architecting", { actor: "agent" }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("architecting agent json", () => {
    expect(
      buildPrompt(result("architecting", { actor: "agent" }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  it("architecting agent with turnDiff plain", () => {
    expect(
      buildPrompt(
        result("architecting", {
          actor: "agent",
          context: {
            turnDiff: "diff --git a/ARCHITECTURE.md b/ARCHITECTURE.md\n+- answer: use option A\n",
          },
        }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("architecting human plain", () => {
    expect(
      buildPrompt(result("architecting", { actor: "human" }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("architecting human json", () => {
    expect(
      buildPrompt(result("architecting", { actor: "human" }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  // ── grilled ───────────────────────────────────────────────────────────────

  it("grilled plain", () => {
    expect(buildPrompt(result("grilled"), resolveModel, "plain")).toMatchSnapshot()
  })

  it("grilled json", () => {
    expect(buildPrompt(result("grilled"), resolveModel, "json")).toMatchSnapshot()
  })

  // ── building ──────────────────────────────────────────────────────────────

  it("building with rich package plain", () => {
    expect(
      buildPrompt(withPackage("building", { packages: [richPackage] }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("building with rich package json", () => {
    expect(
      buildPrompt(withPackage("building", { packages: [richPackage] }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  // ── fixing ────────────────────────────────────────────────────────────────

  it("fixing with empty feedbackContent plain", () => {
    expect(buildPrompt(result("fixing"), resolveModel, "plain")).toMatchSnapshot()
  })

  it("fixing with empty feedbackContent json", () => {
    expect(buildPrompt(result("fixing"), resolveModel, "json")).toMatchSnapshot()
  })

  it("fixing with plain feedbackContent plain", () => {
    expect(
      buildPrompt(
        result("fixing", { context: { feedbackContent: "FAIL: expected 1 to equal 2\n" } }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("fixing with backtick feedbackContent plain", () => {
    expect(
      buildPrompt(
        result("fixing", { context: { feedbackContent: "see ```snippet``` here" } }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  // ── agentic-review ────────────────────────────────────────────────────────

  it("agentic-review with rich package plain", () => {
    expect(
      buildPrompt(
        withPackage("agentic-review", { packages: [richPackage] }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("agentic-review with rich package json", () => {
    expect(
      buildPrompt(withPackage("agentic-review", { packages: [richPackage] }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  it("agentic-review with refDiff and reviewBase plain", () => {
    expect(
      buildPrompt(
        withPackage("agentic-review", {
          packages: [richPackage],
          refDiff: "diff --git a/src/foo.ts b/src/foo.ts\n+export const foo = 1\n",
          reviewBase: "deadbee",
        }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  // ── review ────────────────────────────────────────────────────────────────

  it("review with no diff plain", () => {
    expect(buildPrompt(result("review"), resolveModel, "plain")).toMatchSnapshot()
  })

  it("review with no diff json", () => {
    expect(buildPrompt(result("review"), resolveModel, "json")).toMatchSnapshot()
  })

  it("review with refDiff and reviewBase plain", () => {
    expect(
      buildPrompt(
        result("review", {
          context: {
            refDiff: "diff --git a/x b/x\n+hello\n",
            reviewBase: "abc1234",
          },
        }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("review with refDiff and reviewBase json", () => {
    expect(
      buildPrompt(
        result("review", {
          context: {
            refDiff: "diff --git a/x b/x\n+hello\n",
            reviewBase: "abc1234",
          },
        }),
        resolveModel,
        "json",
      ),
    ).toMatchSnapshot()
  })

  // ── squashing ─────────────────────────────────────────────────────────────

  it("squashing with squashDiff and squashBase plain", () => {
    expect(
      buildPrompt(
        result("squashing", {
          context: {
            squashDiff: "diff --git a/x b/x\n+hello\n",
            squashBase: "abc1234",
          },
        }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("squashing with squashDiff and squashBase json", () => {
    expect(
      buildPrompt(
        result("squashing", {
          context: {
            squashDiff: "diff --git a/x b/x\n+hello\n",
            squashBase: "abc1234",
          },
        }),
        resolveModel,
        "json",
      ),
    ).toMatchSnapshot()
  })
})
