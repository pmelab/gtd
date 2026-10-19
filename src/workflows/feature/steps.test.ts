import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { installContext, type ScopeOptions, type StepRequest } from "../../flows/index.js"
import { captureStep, fixtureContext } from "../shared/text.fixture.js"
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

  it("fixNits with access runs in a review.fix.nits scope, the step named fixing inside it", async () => {
    const scopes: ScopeOptions[] = []
    const steps_: StepRequest[] = []
    const access = { write: ["src/a.ts", ".gtd/**"] }
    installContext(
      fixtureContext(
        { scope: "refactor.build" },
        {
          step: (request) => {
            steps_.push(request)
            return Promise.resolve()
          },
          pushScope: (s) => void scopes.push(s),
          popScope: () => undefined,
          changesSince: () => [],
        },
      ),
    )
    try {
      await steps.fixNits([], access)
    } finally {
      installContext(undefined)
    }
    expect(scopes).toEqual([{ name: "review.fix.nits", access }])
    expect(steps_.map((r) => ("name" in r ? r.name : ""))).toEqual(["fixing"])
  })

  it("deferNotes rests at build.review.defer as a script writing .gtd/TODO.md", async () => {
    const request = await capture(
      () =>
        steps.deferNotes([{ id: "note-1", anchor: "a", text: "x", label: "could" }], "abcdef123"),
      "build",
    )
    if (request.kind !== "run") throw new Error("unreachable")
    expect(request.name).toBe("review.defer")
    expect(request.body).toContain("## Deferred review notes (abcdef1)")
    expect(request.options).toMatchObject({ file: ".gtd/TODO.md" })
  })
})
