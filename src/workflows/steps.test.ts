import { describe, expect, it } from "vitest"
import type { StepRequest } from "../flows/index.js"
import { captureStep } from "./text.fixture.js"
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

describe("the bundled workflow's steps declare skills — a bundled step's rendered prompt carries its bundled skills.ts preamble", () => {
  it("triage carries design.triage's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.triage("base"), "design"))
    expect(prompt).toContain("spec-driven-development, planning-and-task-breakdown")
  })

  it("author carries architecture.author's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.author(), "architecture"))
    expect(prompt).toContain("api-and-interface-design, documentation-and-adrs, ponytail")
  })

  it("decompose carries architecture.decompose's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.decompose(), "architecture"))
    expect(prompt).toContain("incremental-implementation, planning-and-task-breakdown")
  })

  it("build carries packages.item.building's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.build("pkg"), "packages.item"))
    expect(prompt).toContain("test-driven-development, incremental-implementation")
  })

  it("fixSuite carries packages.item.fix.suite's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.fixSuite(), "packages.item"))
    expect(prompt).toContain("debugging-and-error-recovery")
  })

  it("fix carries build.fix's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.fix(), "build"))
    expect(prompt).toContain("debugging-and-error-recovery")
  })

  it("describeEscalation carries health.describe's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.describeEscalation(), "build"))
    expect(prompt).toContain("debugging-and-error-recovery")
  })

  it("reviewQuality names its lens scope, build.quality.<lens>.reviewing", async () => {
    const request = await capture(() => steps.reviewQuality("owasp-security"), "build")
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("quality.owasp-security.reviewing")
  })

  it("an unknown lens's preamble names the lens itself, from the bundled per-lens key", async () => {
    const prompt = agentPrompt(await capture(() => steps.reviewQuality("owasp-security"), "build"))
    expect(prompt).toContain("missing one: owasp-security")
  })

  it("a configured build.quality.<lens> entry replaces the lens's skills in the preamble, every other lens untouched", async () => {
    const skills = { "build.quality.owasp-security": ["my-org-checklist"] }
    const prompt = agentPrompt(
      await capture(() => steps.reviewQuality("owasp-security"), "build", skills),
    )
    expect(prompt).toContain("my-org-checklist")
    expect(prompt).toContain("owasp-security")
  })

  it("correctness carries all four trace points", async () => {
    const request = await capture(() => steps.reviewQuality("correctness"), "build")
    const body = JSON.stringify(request)
    for (const point of [
      "partial-failure",
      "format, not just its presence",
      "parallel write paths",
      "contract test",
    ])
      expect(body).toContain(point)
  })

  it.each(["conventions", "spec-challenge"])("%s carries its brief", async (lens) => {
    const request = await capture(() => steps.reviewQuality(lens), "build")
    expect(JSON.stringify(request)).toContain(
      steps.builtInLenses[lens]!.brief.split("\n")[0]!.slice(0, 40),
    )
  })

  it("an unknown lens has no brief", async () => {
    const request = await capture(() => steps.reviewQuality("my-lens"), "build")
    expect(JSON.stringify(request)).not.toContain("This lens's brief")
  })

  it("fixQuality carries build.fix.quality's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.fixQuality(), "build"))
    expect(prompt).toContain("incremental-implementation, code-simplification")
  })

  it("reviewing carries build.review.reviewing's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.reviewing("base"), "build"))
    expect(prompt).toContain("code-review-and-quality")
  })

  it("collecting carries build.review.collecting's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.collecting("capture"), "build"))
    expect(prompt).toContain("code-review-and-quality")
  })

  it("an empty configured list leaves that step's skills empty, and its rendered prompt bare", async () => {
    const request = await capture(() => steps.fix(), "build", { build: [] })
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).not.toContain("Load whatever's listed here")
  })

  it("answerReviewQuestions answers inline in .gtd/REVIEW.md as the reviewer, with its bundled skills", async () => {
    const request = await capture(
      () =>
        steps.answerReviewQuestions([{ id: "note-1", anchor: "calc ./a.ts#1-1", text: "why?" }]),
      "build",
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("review.answer-review-questions")
    expect(request.options).toMatchObject({
      file: ".gtd/REVIEW.md",
      mode: "review",
    })
    expect(request.prompt).toContain("code-review-and-quality")
    expect(request.prompt).toContain("note-1 — calc ./a.ts#1-1")
    expect(request.prompt).toContain("`A: ` line")
    expect(request.prompt).toContain("gtd check review .gtd/REVIEW.md")
  })

  it("fixNits fixes every nit in one turn and leaves .gtd/REVIEW.md alone", async () => {
    const request = await capture(
      () =>
        steps.fixNits([
          { id: "note-1", anchor: "calc ./a.ts#1-1", text: "typo" },
          { id: "note-2", anchor: "calc ./a.ts#2-2", text: "semicolon" },
        ]),
      "build",
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("review.fix.nits.fixing")
    expect(request.prompt).toContain("incremental-implementation, code-simplification")
    expect(request.prompt).toContain("typo")
    expect(request.prompt).toContain("semicolon")
    expect(request.prompt).toContain("Leave `.gtd/REVIEW.md` untouched")
  })

  it("fixRisks fixes every risk, tolerates an empty turn, and leaves .gtd/REVIEW.md alone", async () => {
    const request = await capture(
      () => steps.fixRisks([{ id: "risk-1", anchor: "calc ./a.ts#1-1", text: "Risk: drops it" }]),
      "build",
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("review.fix.risks.fixing")
    expect(request.options).toMatchObject({ allowEmpty: true })
    expect(request.prompt).toContain("debugging-and-error-recovery, incremental-implementation")
    expect(request.prompt).toContain("risk-1 — calc ./a.ts#1-1")
    expect(request.prompt).toContain("Risk: drops it")
    expect(request.prompt).toContain("Leave `.gtd/REVIEW.md` untouched")
  })

  it("reviewing names the carry-over commit only when given one", async () => {
    const bare = await capture(() => steps.reviewing("base"), "build")
    const carried = await capture(() => steps.reviewing("base", "abc1234"), "build")
    if (bare.kind !== "agent" || carried.kind !== "agent") throw new Error("unreachable")
    expect(bare.prompt).not.toContain("Carry-over")
    expect(carried.prompt).toContain("Carry-over: commit `abc1234`")
  })
})
