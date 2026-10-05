import { describe, expect, it } from "vitest"
import type { StepRequest } from "../flows/index.js"
import { captureStep } from "./text.fixture.js"
import * as steps from "./steps.js"

const capture = (
  fn: () => Promise<void>,
  skills?: Readonly<Record<string, readonly string[]>>,
): Promise<StepRequest> => captureStep(fn, skills !== undefined ? { skills } : {})

const agentPrompt = (request: StepRequest): string => {
  if (request.kind !== "agent") throw new Error(`expected an agent step, got ${request.kind}`)
  return request.prompt
}

// The preamble (`agentPrompt`) reflects `skillsFor`'s resolved map — but the
// WIRE `skills` field a request actually carries is whatever `options.skills`
// the step itself passed; `Replay.ts`'s `resolve()` only overrides it from
// `.gtdrc` (never reachable here — this fixture skips replay entirely). Most
// bundled steps pass no `skills` option of their own, so this is normally
// `undefined`; `reviewQuality` is the one step that does.
const agentSkillsOption = (request: StepRequest): readonly string[] | undefined => {
  if (request.kind !== "agent") throw new Error(`expected an agent step, got ${request.kind}`)
  return request.options.skills
}

describe("the bundled workflow's steps declare skills — a bundled step's rendered prompt carries its bundled skills.ts preamble", () => {
  it("triage carries design.triage's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.triage("base")))
    expect(prompt).toContain("spec-driven-development, planning-and-task-breakdown")
  })

  it("author carries architecture.author's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.author()))
    expect(prompt).toContain("api-and-interface-design, documentation-and-adrs, ponytail")
  })

  it("decompose carries architecture.decompose's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.decompose()))
    expect(prompt).toContain("incremental-implementation, planning-and-task-breakdown")
  })

  it("build carries packages.item.building's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.build("pkg")))
    expect(prompt).toContain("test-driven-development, incremental-implementation")
  })

  it("fixSuite carries packages.item.fix-suite's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.fixSuite()))
    expect(prompt).toContain("debugging-and-error-recovery")
  })

  it("fixSpec carries packages.item.fix-spec's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.fixSpec("pkg")))
    expect(prompt).toContain("incremental-implementation, code-simplification")
  })

  it("reviewPackage carries packages.item.spec.review's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.reviewPackage("pkg")))
    expect(prompt).toContain("code-review-and-quality, spec-driven-development")
  })

  it("fix carries build.fix's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.fix()))
    expect(prompt).toContain("debugging-and-error-recovery")
  })

  it("describeEscalation carries health.describe's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.describeEscalation()))
    expect(prompt).toContain("debugging-and-error-recovery")
  })

  it("reviewQuality's preamble falls back to the lens itself by default — build.quality.reviewing bundles no fixed skills of its own", async () => {
    const prompt = agentPrompt(await capture(() => steps.reviewQuality("owasp-security")))
    expect(prompt).toContain("missing one: owasp-security")
  })

  it("reviewQuality's own wire skills option IS the lens by default — the same list its preamble now names, never one without the other", async () => {
    const request = await capture(() => steps.reviewQuality("owasp-security"))
    expect(agentSkillsOption(request)).toEqual(["owasp-security"])
  })

  it("reviewQuality's preamble reflects a configured build.quality.reviewing entry, every turn, regardless of lens", async () => {
    const prompt = agentPrompt(
      await capture(() => steps.reviewQuality("owasp-security"), {
        "quality.reviewing": ["my-org-checklist"],
      }),
    )
    expect(prompt).toContain("my-org-checklist")
    // The body still names the lens — what makes N otherwise identical prompts distinguishable.
    expect(prompt).toContain("owasp-security")
  })

  it("correctness loads code-review-and-quality and carries all four trace points", async () => {
    const request = await capture(() => steps.reviewQuality("correctness"))
    expect(agentSkillsOption(request)).toEqual(["code-review-and-quality"])
    const body = JSON.stringify(request)
    for (const point of [
      "partial-failure",
      "format, not just its presence",
      "parallel write paths",
      "contract test",
    ])
      expect(body).toContain(point)
  })

  it.each(["conventions", "spec-challenge"])(
    "%s sends no skills and carries its brief",
    async (lens) => {
      const request = await capture(() => steps.reviewQuality(lens))
      expect(agentSkillsOption(request)).toEqual([])
      expect(JSON.stringify(request)).toContain(
        steps.builtInLenses[lens]!.brief.split("\n")[0]!.slice(0, 40),
      )
    },
  )

  it("an unknown lens loads itself as a skill, with no brief", async () => {
    const request = await capture(() => steps.reviewQuality("my-lens"))
    expect(agentSkillsOption(request)).toEqual(["my-lens"])
    expect(JSON.stringify(request)).not.toContain("This lens's brief")
  })

  it("a configured build.quality.reviewing entry replaces a built-in lens's skills; the brief stays", async () => {
    const prompt = agentPrompt(
      await capture(() => steps.reviewQuality("conventions"), {
        "quality.reviewing": ["my-org-checklist"],
      }),
    )
    expect(prompt).toContain("my-org-checklist")
    expect(prompt).toContain("AGENTS.md")
  })

  it("fixQuality carries build.fix-quality's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.fixQuality()))
    expect(prompt).toContain("incremental-implementation, code-simplification")
  })

  it("reviewing carries build.review.reviewing's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.reviewing("base")))
    expect(prompt).toContain("code-review-and-quality")
  })

  it("collecting carries build.review.collecting's bundled skills", async () => {
    const prompt = agentPrompt(await capture(() => steps.collecting("capture")))
    expect(prompt).toContain("code-review-and-quality")
  })

  it("an empty configured list leaves that step's skills empty, and its rendered prompt bare", async () => {
    const request = await capture(() => steps.fix(), { fix: [] })
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.prompt).not.toContain("Load whatever's listed here")
  })

  it("answerReviewQuestions answers inline in .gtd/REVIEW.md as the reviewer, with its bundled skills", async () => {
    const request = await capture(() =>
      steps.answerReviewQuestions([{ id: "note-1", anchor: "calc ./a.ts#1-1", text: "why?" }]),
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
    const request = await capture(() =>
      steps.fixNits([
        { id: "note-1", anchor: "calc ./a.ts#1-1", text: "typo" },
        { id: "note-2", anchor: "calc ./a.ts#2-2", text: "semicolon" },
      ]),
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("review.fix-nits")
    expect(request.prompt).toContain("incremental-implementation, code-simplification")
    expect(request.prompt).toContain("typo")
    expect(request.prompt).toContain("semicolon")
    expect(request.prompt).toContain("Leave `.gtd/REVIEW.md` untouched")
  })

  it("fixRisks fixes every risk, tolerates an empty turn, and leaves .gtd/REVIEW.md alone", async () => {
    const request = await capture(() =>
      steps.fixRisks([{ id: "risk-1", anchor: "calc ./a.ts#1-1", text: "Risk: drops it" }]),
    )
    if (request.kind !== "agent") throw new Error("unreachable")
    expect(request.name).toBe("review.fix-risks")
    expect(request.options).toMatchObject({ allowEmpty: true })
    expect(request.prompt).toContain("debugging-and-error-recovery, incremental-implementation")
    expect(request.prompt).toContain("risk-1 — calc ./a.ts#1-1")
    expect(request.prompt).toContain("Risk: drops it")
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
