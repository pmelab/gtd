import { describe, expect, it } from "vitest"
import type { StepRequest } from "../flows/index.js"
import { captureStep } from "./text.fixture.js"
import * as steps from "./steps.js"

const capture = (
  fn: () => Promise<void>,
  vars: Readonly<Record<string, string>> = {},
): Promise<StepRequest> => captureStep(fn, { vars })

const agentSkills = (request: StepRequest): readonly string[] | undefined => {
  if (request.kind !== "agent") throw new Error(`expected an agent step, got ${request.kind}`)
  return request.options.skills
}

describe("the bundled workflow's steps declare skills", () => {
  it("triage declares triageSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.triage("base")))).toEqual([
      "spec-driven-development",
      "planning-and-task-breakdown",
    ])
  })

  it("author declares architectureSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.author()))).toEqual([
      "api-and-interface-design",
      "documentation-and-adrs",
    ])
  })

  it("decompose declares decomposeSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.decompose()))).toEqual([
      "incremental-implementation",
      "planning-and-task-breakdown",
    ])
  })

  it("build declares buildSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.build("pkg")))).toEqual([
      "test-driven-development",
      "incremental-implementation",
    ])
  })

  it("fixSuite declares fixSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.fixSuite()))).toEqual([
      "debugging-and-error-recovery",
    ])
  })

  it("fixSpec declares reviewFixSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.fixSpec("pkg")))).toEqual([
      "incremental-implementation",
      "code-simplification",
    ])
  })

  it("reviewPackage declares specReviewSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.reviewPackage("pkg")))).toEqual([
      "code-review-and-quality",
      "spec-driven-development",
    ])
  })

  it("fix declares fixSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.fix()))).toEqual(["debugging-and-error-recovery"])
  })

  it("describeEscalation declares escalateSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.describeEscalation()))).toEqual([
      "debugging-and-error-recovery",
    ])
  })

  it("reviewQuality declares exactly the one lens handed to it, not split further", async () => {
    expect(agentSkills(await capture(() => steps.reviewQuality("owasp-security")))).toEqual([
      "owasp-security",
    ])
  })

  it("fixQuality declares reviewFixSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.fixQuality()))).toEqual([
      "incremental-implementation",
      "code-simplification",
    ])
  })

  it("reviewing declares reviewSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.reviewing("base")))).toEqual([
      "code-review-and-quality",
    ])
  })

  it("collecting declares reviewSkills, split", async () => {
    expect(agentSkills(await capture(() => steps.collecting("capture")))).toEqual([
      "code-review-and-quality",
    ])
  })

  it("a blanked *Skills var leaves that step's skills empty, and its rendered prompt bare", async () => {
    const request = await capture(() => steps.fix(), { fixSkills: "" })
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.options.skills).toEqual([])
    expect(request.prompt).not.toContain("Load whatever's listed here")
  })
})
