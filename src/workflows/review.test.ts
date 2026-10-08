import { afterEach, describe, expect, it } from "vitest"
import { installContext, type Change, type JudgeAnswer, type StepRequest } from "../flows/index.js"
import { review, type ReviewOutcome } from "./review.js"
import { unified } from "./index.js"
import { fixtureContext } from "./text.fixture.js"

afterEach(() => installContext(undefined))

const REVIEW = ".gtd/REVIEW.md"
const REQUIREMENTS = ".gtd/REQUIREMENTS.md"

class Stop extends Error {}

const doc = (notes: readonly string[]): string =>
  [
    "# Review: abc1234",
    "",
    "<!-- base: 0000000000000000000000000000000000000000 -->",
    "",
    "## calc",
    ...notes.flatMap((note, i) => [`- [ ] ./src/calc.ts#${i + 1}-${i + 1}`, note]),
    "",
  ].join("\n")

const BEFORE = doc(["add", "sub", "mul"])

interface Drive {
  readonly notes: readonly string[]
  readonly answers?: Readonly<Record<string, JudgeAnswer>>
  readonly truncated?: readonly string[]
  readonly vars?: Readonly<Record<string, string>>
  /** The REVIEW.md the human leaves; defaults to `notes` laid over the baseline. */
  readonly after?: string
  /** The REVIEW.md each `review.reviewing` turn writes, in order; also raises the review-turn stop to one past the last. */
  readonly reviewDocs?: readonly (string | undefined)[]
}

interface Run {
  readonly log: string[]
  readonly prompts: Map<string, string>
  readonly result: ReviewOutcome | "stopped"
  readonly judged: readonly string[]
}

/** Run `review` against a scripted context; a second pass at the gate or a fresh review stops the run. */
const drive = async (d: Drive): Promise<Run> => {
  const log: string[] = []
  const prompts = new Map<string, string>()
  const judged: string[] = []
  const files = new Map<string, string>([[REVIEW, d.after ?? doc(d.notes)]])
  let steps = 0
  let nitsFixed = false
  let awaits = 0
  let reviews = 0
  const effects: Record<string, () => void> = {
    "review.reviewing": () => {
      const docs = d.reviewDocs
      if (++reviews > (docs?.length ?? 0) + (docs === undefined ? 1 : 0)) throw new Stop()
      const written = docs?.[reviews - 1]
      if (written !== undefined) files.set(REVIEW, written)
    },
    "review.await-review": () => {
      if (++awaits > 1) throw new Stop()
    },
    "review.closing": () => void files.delete(REVIEW),
    "review.collecting": () => void files.set(REQUIREMENTS, "## Concern"),
    "review.fix-nits": () => {
      nitsFixed = true
    },
  }
  const context = fixtureContext(
    { vars: d.vars ?? {} },
    {
      step: (request: StepRequest) => {
        steps++
        if (request.kind === "restart") return Promise.resolve()
        log.push(request.name)
        if (request.kind === "agent") prompts.set(request.name, request.prompt)
        effects[request.name]?.()
        if (request.kind !== "judge") return Promise.resolve()
        judged.push(...request.questions.map((q) => q.id))
        return Promise.resolve({ answers: d.answers ?? {}, truncated: d.truncated ?? [] })
      },
      refuse: (message: string): never => {
        throw new Error(message)
      },
      pushScope: () => undefined,
      popScope: () => undefined,
      read: (path) => files.get(path),
      changesSince: (): readonly Change[] => [
        { path: REVIEW, status: "modified", before: BEFORE, after: files.get(REVIEW) },
        ...(nitsFixed
          ? [{ path: "src/calc.ts", status: "modified" as const, before: "a", after: "b" }]
          : []),
      ],
      head: () => `c${steps}`,
      start: () => "c0",
    },
  )
  installContext(context)
  let result: ReviewOutcome | "stopped"
  try {
    result = await review("base")
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    result = "stopped"
  }
  return { log, prompts, result, judged }
}

const verdict = (answer: string, p = 0.9): JudgeAnswer => ({ answer, p })

describe("the risk-fix pass", () => {
  const risky = doc(["Risk: drops the carry", "sub"])
  const clean = doc(["add — fine", "sub"])

  it("a marked risk is fixed, kept green, re-reviewed, then rests at the gate", async () => {
    const run = await drive({ notes: [], reviewDocs: [risky, clean] })
    expect(run.log.slice(0, 5)).toEqual([
      "review.reviewing",
      "review.fix-risks",
      "health.check",
      "review.reviewing",
      "review.await-review",
    ])
    expect(run.prompts.get("review.fix-risks")).toContain("risk-1")
    expect(run.prompts.get("review.fix-risks")).toContain("Risk: drops the carry")
    expect(run.prompts.get("review.fix-risks")).toContain("Leave `.gtd/REVIEW.md` untouched")
  })

  it("a risk the re-review still marks goes to the gate with no second fix", async () => {
    const run = await drive({ notes: [], reviewDocs: [risky, risky] })
    expect(run.log.filter((n) => n === "review.fix-risks")).toHaveLength(1)
    expect(run.log.slice(0, 5)).toEqual([
      "review.reviewing",
      "review.fix-risks",
      "health.check",
      "review.reviewing",
      "review.await-review",
    ])
  })

  it("no marker means no fix-risks step", async () => {
    const run = await drive({ notes: [], reviewDocs: [clean] })
    expect(run.log).not.toContain("review.fix-risks")
    expect(run.log[0]).toBe("review.reviewing")
    expect(run.log[1]).toBe("review.await-review")
  })

  it("a nit re-review round gets its own single pass", async () => {
    const run = await drive({
      notes: ["add — typo", "sub", "mul"],
      answers: { "note-1": verdict("nit") },
      reviewDocs: [undefined, risky, clean],
    })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.triage",
      "review.fix-nits",
      "health.check",
      "review.closing",
      "review.reviewing",
      "review.fix-risks",
      "health.check",
      "review.reviewing",
      "review.await-review",
    ])
  })
})

describe("review verdict routing", () => {
  const notes = ["add — typo", "sub", "mul"]

  it("judges one note per added note, as one judge rest", async () => {
    const run = await drive({ notes: ["add — a", "sub — b", "mul"] })
    expect(run.judged).toEqual(["note-1", "note-2"])
    expect(run.log.filter((n) => n === "review.triage")).toHaveLength(1)
  })

  it("an unanswered note counts as edit", async () => {
    const run = await drive({ notes: ["add — typo", "sub", "mul"], answers: {} })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.triage",
      "review.closing",
      "review.collecting",
    ])
    expect(run.result).toMatchObject({ verdict: "feedback" })
  })

  it("a cut note counts as edit despite a confident praise", async () => {
    const run = await drive({
      notes,
      answers: { "note-1": verdict("praise", 0.99) },
      truncated: ["note-1"],
    })
    expect(run.log).toContain("review.collecting")
  })

  it("a verdict below the reviewNoteActionable floor counts as edit", async () => {
    const run = await drive({ notes, answers: { "note-1": verdict("praise", 0.5) } })
    expect(run.log).toContain("review.collecting")
  })

  it("a blank floor makes every note an edit", async () => {
    const run = await drive({
      notes,
      answers: { "note-1": verdict("praise", 1) },
      vars: { reviewNoteActionable: "" },
    })
    expect(run.log).toContain("review.collecting")
  })

  it("only praise closes and signs off with no agent turn", async () => {
    const run = await drive({ notes, answers: { "note-1": verdict("praise") } })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.triage",
      "review.closing",
    ])
    expect(run.result).toEqual({ verdict: "signoff" })
  })

  it("questions only are answered, then the gate again, never closed", async () => {
    const run = await drive({
      notes: ["add — why?", "sub — and here?", "mul"],
      answers: { "note-1": verdict("question"), "note-2": verdict("question") },
    })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.triage",
      "review.answer-review-questions",
      "review.await-review",
    ])
    expect(run.prompts.get("review.answer-review-questions")).toContain("note-2")
    expect(run.result).toBe("stopped")
  })

  it("nits without edits are fixed, kept green, closed, then re-reviewed with the answers carried", async () => {
    const run = await drive({
      notes: ["add — why?", "sub — typo", "mul"],
      answers: { "note-1": verdict("question"), "note-2": verdict("nit") },
    })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.triage",
      "review.answer-review-questions",
      "review.fix-nits",
      "health.check",
      "review.closing",
      "review.reviewing",
    ])
    expect(run.prompts.get("review.fix-nits")).not.toContain("why?")
    expect(run.prompts.get("review.reviewing")).toContain("Carry-over: commit `c4`")
    expect(run.result).toBe("stopped")
  })

  it("nits alone carry nothing over", async () => {
    const run = await drive({
      notes: ["add — typo", "sub", "mul"],
      answers: { "note-1": verdict("nit") },
    })
    expect(run.prompts.get("review.reviewing")).not.toContain("Carry-over")
  })

  it("edits run after questions and nits, and the capture names only the edits and the answering commit", async () => {
    const run = await drive({
      notes: ["add — rename it", "sub — why?", "mul — typo"],
      answers: { "note-2": verdict("question"), "note-3": verdict("nit") },
    })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.triage",
      "review.answer-review-questions",
      "review.fix-nits",
      "health.check",
      "review.closing",
      "review.collecting",
    ])
    const capture = run.prompts.get("review.collecting") ?? ""
    expect(capture).toContain("note-1")
    expect(capture).toContain("rename it")
    expect(capture).not.toContain("note-2 —")
    expect(capture).not.toContain("note-3 —")
    expect(capture).toContain("commit c4 answered")
  })

  it("a noted round with no extractable note collects as one edit, without judging", async () => {
    const run = await drive({ notes: [], after: BEFORE + "\nSome stray prose.\n" })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.closing",
      "review.collecting",
    ])
    expect(run.prompts.get("review.collecting")).toContain("The human's notes are in")
  })

  it("never counts a nit fix as a hand-edit", async () => {
    const run = await drive({
      notes: ["add — rename it", "sub — typo", "mul"],
      answers: { "note-2": verdict("nit") },
    })
    expect(run.result).toMatchObject({ verdict: "feedback", edited: [] })
  })
})

describe("the default quality lenses", () => {
  it("are the six lenses in the settled order", () => {
    expect(unified.defaults.qualityReviews!.split(",").map((l) => l.trim())).toEqual([
      "correctness",
      "owasp-security",
      "ponytail-review",
      "test-audit",
      "conventions",
      "spec-challenge",
    ])
  })

  it("expose builtInLenses through the public workflow module", () => {
    expect(Object.keys(unified.builtInLenses).sort()).toEqual([
      "conventions",
      "correctness",
      "spec-challenge",
    ])
  })
})

describe("scenario wording in review's fix turns", () => {
  const frozen = { at: "h1", texts: { "e2e/a.feature": "Given a" } }
  const risky = doc(["Risk: drops the carry", "sub"])

  it("a green-keeping fix after a risk fix that rewrites a scenario stops at review.scenario-wording", async () => {
    const log: string[] = []
    let red = false
    let drifted = false
    installContext(
      fixtureContext(
        {},
        {
          step: (request: StepRequest) => {
            if (request.kind === "restart") return Promise.resolve()
            log.push(request.name)
            if (request.name === "health.check") red = !red && !drifted
            if (request.name === "fix") drifted = true
            if (request.name === "scenario-wording") throw new Stop()
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          read: (path) =>
            path === REVIEW
              ? risky
              : path === "e2e/a.feature"
                ? drifted
                  ? "Given b"
                  : "Given a"
                : undefined,
          changes: (): readonly Change[] =>
            red
              ? [{ path: ".gtd/FEEDBACK.md", status: "added", before: undefined, after: "red" }]
              : [],
          matches: (path, pattern) => path === pattern,
          head: () => "h2",
          start: () => "h0",
        },
      ),
    )
    await review("base", undefined, frozen).catch((e: unknown) => {
      if (!(e instanceof Stop)) throw e
    })
    expect(log.slice(-2)).toEqual(["fix", "scenario-wording"])
  })
})
