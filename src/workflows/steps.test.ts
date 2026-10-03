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
      "ponytail",
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

  it("answerReviewQuestions answers inline in .gtd/REVIEW.md as the reviewer, with reviewSkills", async () => {
    const request = await capture(() =>
      steps.answerReviewQuestions([{ id: "note-1", anchor: "calc ./a.ts#1-1", text: "why?" }]),
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("review.answer-review-questions")
    expect(request.options).toMatchObject({
      file: ".gtd/REVIEW.md",
      mode: "review",
      skills: ["code-review-and-quality"],
    })
    expect(request.prompt).toContain("note-1 — calc ./a.ts#1-1")
    expect(request.prompt).toContain("`A: ` line")
    expect(request.prompt).toContain("gtd check review .gtd/REVIEW.md")
  })

  it("fixNits fixes every nit in one turn and leaves .gtd/REVIEW.md alone", async () => {
    const request = await capture(() =>
      steps.fixNits([
        { id: "note-1", anchor: "calc ./a.ts#1-1", text: "typo" },
        { id: "note-2", anchor: "calc ./a.ts#2-2", text: "semicolon" },
      ]),
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("review.fix-nits")
    expect(request.options.skills).toEqual(["incremental-implementation", "code-simplification"])
    expect(request.prompt).toContain("typo")
    expect(request.prompt).toContain("semicolon")
    expect(request.prompt).toContain("Leave `.gtd/REVIEW.md` untouched")
  })

  it("reviewing names the carry-over commit only when given one", async () => {
    const bare = await capture(() => steps.reviewing("base"))
    const carried = await capture(() => steps.reviewing("base", "abc1234"))
    if (bare.kind !== "agent" || carried.kind !== "agent") throw new Error("unreachable")
    expect(bare.prompt).not.toContain("Carry-over")
    expect(carried.prompt).toContain("Carry-over: commit `abc1234`")
  })
})
