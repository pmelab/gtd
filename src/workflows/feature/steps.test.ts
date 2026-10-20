import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { StepRequest } from "../../flows/index.js"
import { captureStep } from "../shared/text.fixture.js"
import * as steps from "./steps.js"

const capture = (
  fn: () => Promise<void>,
  scope: string,
  skills?: Readonly<Record<string, readonly string[]>>,
): Promise<StepRequest> => captureStep(fn, { scope, ...(skills !== undefined ? { skills } : {}) })

const agentPrompt = (request: StepRequest): string => {
  if (request.kind !== "agent") throw new Error(`expected an agent step, got ${request.kind}`)
  return request.prompt
}

describe("the feature workflow's own steps declare skills — a step's rendered prompt carries its bundled skills.ts preamble", () => {
  it("triage carries design.triage's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.triage("base"), "design"))
    expect(prompt).toContain("spec-driven-development, planning-and-task-breakdown")
  })

  it("collecting carries build.review.collecting's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.collecting("capture"), "build"))
    expect(prompt).toContain("code-review-and-quality")
  })

  it("collecting's prompt is the pinned feature fixture", async () => {
    const prompt = agentPrompt(await capture(() => steps.collecting("capture-text"), "build"))
    expect(prompt).toContain(
      readFileSync(
        new URL("../shared/__fixtures__/feature-collecting-prompt.txt", import.meta.url),
        "utf8",
      ),
    )
  })

  it("refactorCollecting renders the open variant for the reply round, the closed one otherwise, whatever .gtd/REVIEW.md holds", async () => {
    const at = (round: "reply" | "edits", present: boolean): Promise<StepRequest> =>
      captureStep(() => steps.refactorCollecting("capture", round, ["src/a.ts"]), {
        scope: "refactor.build",
        read: (path) => (present && path === ".gtd/REVIEW.md" ? "# Review" : undefined),
      })
    const open = agentPrompt(await at("reply", false))
    const closed = agentPrompt(await at("edits", true))
    expect(open).toContain("exactly one `- A:` reply")
    expect(open).not.toContain("already closed")
    expect(closed).toContain("already closed")
    expect(closed).not.toContain("exactly one `- A:` reply")
  })
})

describe("the feature workflow's planning steps run on the planner model", () => {
  it("design triage defaults to smart and follows plannerModel", async () => {
    const plain = await captureStep(() => steps.triage("base"), { scope: "design" })
    const set = await captureStep(() => steps.triage("base"), {
      scope: "design",
      env: { plannerModel: "opus" },
    })
    if (plain.kind !== "agent" || set.kind !== "agent") throw new Error("unreachable")
    expect(plain.options.model).toBe("smart")
    expect(set.options.model).toBe("opus")
  })
})
