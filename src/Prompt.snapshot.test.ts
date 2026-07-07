import { describe, expect, it } from "vitest"
import { buildPrompt } from "./Prompt.js"
import type { GtdPackageFact, GtdState, ResolveContext, Result } from "./Machine.js"

// Fixed resolver so snapshots are independent of Config.ts defaults
const resolveModel = (s: string): string => `MODEL-${s}`

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
  autoAdvance = true,
): Result => result(state, { autoAdvance, context: { packages: [onePackage], ...context } })

describe("buildPrompt snapshots", () => {
  // ── STOP states (no model) ────────────────────────────────────────────────

  it("idle plain", () => {
    expect(buildPrompt(result("idle"), resolveModel, "plain")).toMatchSnapshot()
  })

  it("idle json", () => {
    expect(buildPrompt(result("idle"), resolveModel, "json")).toMatchSnapshot()
  })

  it("escalate plain", () => {
    expect(buildPrompt(result("escalate"), resolveModel, "plain")).toMatchSnapshot()
  })

  it("escalate json", () => {
    expect(buildPrompt(result("escalate"), resolveModel, "json")).toMatchSnapshot()
  })

  // ── grilling ─────────────────────────────────────────────────────────────

  it("grilling iterate plain", () => {
    expect(
      buildPrompt(
        result("grilling", { autoAdvance: true, context: { grillingCase: "iterate" } }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("grilling iterate json", () => {
    expect(
      buildPrompt(
        result("grilling", { autoAdvance: true, context: { grillingCase: "iterate" } }),
        resolveModel,
        "json",
      ),
    ).toMatchSnapshot()
  })

  it("grilling stop plain", () => {
    expect(
      buildPrompt(
        result("grilling", { autoAdvance: false, context: { grillingCase: "stop" } }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("grilling stop json", () => {
    expect(
      buildPrompt(
        result("grilling", { autoAdvance: false, context: { grillingCase: "stop" } }),
        resolveModel,
        "json",
      ),
    ).toMatchSnapshot()
  })

  // ── grilled-review ────────────────────────────────────────────────────────

  it("grilled-review plain", () => {
    expect(
      buildPrompt(result("grilled-review", { autoAdvance: false }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("grilled-review json", () => {
    expect(
      buildPrompt(result("grilled-review", { autoAdvance: false }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  // ── grilled / planning ────────────────────────────────────────────────────

  it("grilled plain", () => {
    expect(
      buildPrompt(result("grilled", { autoAdvance: true }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("grilled json", () => {
    expect(
      buildPrompt(result("grilled", { autoAdvance: true }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  it("planning plain", () => {
    expect(
      buildPrompt(result("planning", { autoAdvance: true }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("planning json", () => {
    expect(
      buildPrompt(result("planning", { autoAdvance: true }), resolveModel, "json"),
    ).toMatchSnapshot()
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
    expect(
      buildPrompt(result("fixing", { autoAdvance: true }), resolveModel, "plain"),
    ).toMatchSnapshot()
  })

  it("fixing with empty feedbackContent json", () => {
    expect(
      buildPrompt(result("fixing", { autoAdvance: true }), resolveModel, "json"),
    ).toMatchSnapshot()
  })

  it("fixing with plain feedbackContent plain", () => {
    expect(
      buildPrompt(
        result("fixing", {
          autoAdvance: true,
          context: { feedbackContent: "FAIL: expected 1 to equal 2\n" },
        }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })

  it("fixing with backtick feedbackContent plain", () => {
    expect(
      buildPrompt(
        result("fixing", {
          autoAdvance: true,
          context: { feedbackContent: "see ```snippet``` here" },
        }),
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

  // ── clean ─────────────────────────────────────────────────────────────────

  it("clean with no diff plain", () => {
    expect(buildPrompt(result("clean"), resolveModel, "plain")).toMatchSnapshot()
  })

  it("clean with no diff json", () => {
    expect(buildPrompt(result("clean"), resolveModel, "json")).toMatchSnapshot()
  })

  it("clean with refDiff and reviewBase plain", () => {
    expect(
      buildPrompt(
        result("clean", {
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

  it("clean with refDiff and reviewBase json", () => {
    expect(
      buildPrompt(
        result("clean", {
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
          autoAdvance: true,
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
          autoAdvance: true,
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

  // ── dirty working tree ────────────────────────────────────────────────────

  it("fixing with dirty working tree and diff plain", () => {
    expect(
      buildPrompt(
        result("fixing", {
          autoAdvance: true,
          context: {
            workingTreeClean: false,
            diff: "diff --git a/foo b/foo\n+changed\n",
            feedbackContent: "FAIL: tests failed",
          },
        }),
        resolveModel,
        "plain",
      ),
    ).toMatchSnapshot()
  })
})
