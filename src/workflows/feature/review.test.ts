import { afterEach, describe, expect, it } from "vitest"
import {
  installContext,
  type Change,
  type JudgeAnswer,
  type StepRequest,
} from "../../flows/index.js"
import { review, severityOf, type ReviewOutcome } from "./review.js"
import type { ReviewNote } from "../../steering/index.js"
import * as bundled from "../index.js"
import { fixtureContext } from "../shared/text.fixture.js"

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
  /** Let the run pass the second gate, stopping at the first range read after it. */
  readonly passSecondGate?: boolean
}

interface Run {
  readonly log: string[]
  readonly prompts: Map<string, string>
  readonly result: ReviewOutcome | "stopped"
  readonly judged: readonly string[]
  /** `acceptClean` of each `review.await-review` gate, in order. */
  readonly gates: readonly boolean[]
  readonly gateMessages: readonly string[]
  /** Every `changesSince` argument, in order. */
  readonly since: readonly string[]
}

/** Run `review` against a scripted context; a second pass at the gate or a fresh review stops the run. */
const drive = async (d: Drive): Promise<Run> => {
  const log: string[] = []
  const prompts = new Map<string, string>()
  const judged: string[] = []
  const gates: boolean[] = []
  const gateMessages: string[] = []
  const since: string[] = []
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
      if (++awaits > (d.passSecondGate ? 2 : 1)) throw new Stop()
    },
    "review.closing": () => void files.delete(REVIEW),
    "review.collecting": () => void files.set(REQUIREMENTS, "## Concern"),
    "review.fix.nits.fixing": () => {
      nitsFixed = true
    },
  }
  const record = (request: StepRequest): void => {
    if (request.kind === "human" && request.name === "review.await-review") {
      gates.push(request.options.acceptClean === true)
      gateMessages.push(request.options.message ?? "")
    }
    if (request.kind === "agent") prompts.set(request.name, request.prompt)
    if (request.kind === "judge") judged.push(...request.questions.map((q) => q.id))
  }
  const context = fixtureContext(
    { vars: d.vars ?? {} },
    {
      step: (request: StepRequest) => {
        steps++
        if (request.kind === "restart") return Promise.resolve()
        log.push(request.name)
        record(request)
        effects[request.name]?.()
        if (request.kind !== "judge") return Promise.resolve()
        return Promise.resolve({ answers: d.answers ?? {}, truncated: d.truncated ?? [] })
      },
      refuse: (message: string): never => {
        throw new Error(message)
      },
      pushScope: () => undefined,
      popScope: () => undefined,
      read: (path) => files.get(path),
      changesSince: (from: string): readonly Change[] => {
        since.push(from)
        if (d.passSecondGate && awaits === 2) throw new Stop()
        return [
          { path: REVIEW, status: "modified", before: BEFORE, after: files.get(REVIEW) },
          ...(nitsFixed
            ? [{ path: "src/calc.ts", status: "modified" as const, before: "a", after: "b" }]
            : []),
        ]
      },
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
  return { log, prompts, result, judged, gates, gateMessages, since }
}

const verdict = (answer: string, p = 0.9): JudgeAnswer => ({ answer, p })

describe("the risk-fix pass", () => {
  const risky = doc(["Risk: drops the carry", "sub"])
  const clean = doc(["add — fine", "sub"])

  it("a marked risk is fixed, kept green, re-reviewed, then rests at the gate", async () => {
    const run = await drive({ notes: [], reviewDocs: [risky, clean] })
    expect(run.log.slice(0, 5)).toEqual([
      "review.reviewing",
      "review.fix.risks.fixing",
      "health.check",
      "review.reviewing",
      "review.await-review",
    ])
    expect(run.prompts.get("review.fix.risks.fixing")).toContain("risk-1")
    expect(run.prompts.get("review.fix.risks.fixing")).toContain("Risk: drops the carry")
    expect(run.prompts.get("review.fix.risks.fixing")).toContain("Leave `.gtd/REVIEW.md` untouched")
  })

  it("a risk the re-review still marks goes to the gate with no second fix", async () => {
    const run = await drive({ notes: [], reviewDocs: [risky, risky] })
    expect(run.log.filter((n) => n === "review.fix.risks.fixing")).toHaveLength(1)
    expect(run.log.slice(0, 5)).toEqual([
      "review.reviewing",
      "review.fix.risks.fixing",
      "health.check",
      "review.reviewing",
      "review.await-review",
    ])
  })

  it("no marker means no fix-risks step", async () => {
    const run = await drive({ notes: [], reviewDocs: [clean] })
    expect(run.log).not.toContain("review.fix.risks.fixing")
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
      "review.fix.nits.fixing",
      "health.check",
      "review.closing",
      "review.reviewing",
      "review.fix.risks.fixing",
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
    expect(run.judged).toEqual([
      "note-1",
      "note-1.security",
      "note-1.reversibility",
      "note-1.blastRadius",
      "note-1.newConcept",
      "note-2",
      "note-2.security",
      "note-2.reversibility",
      "note-2.blastRadius",
      "note-2.newConcept",
    ])
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
      "review.fix.nits.fixing",
      "health.check",
      "review.closing",
      "review.reviewing",
    ])
    expect(run.prompts.get("review.fix.nits.fixing")).not.toContain("why?")
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
      "review.fix.nits.fixing",
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
    expect(bundled.defaults.qualityReviews!.split(",").map((l) => l.trim())).toEqual([
      "correctness",
      "owasp-security",
      "ponytail-review",
      "test-audit",
      "conventions",
      "spec-challenge",
    ])
  })

  it("expose builtInLenses through the public workflow module", () => {
    expect(Object.keys(bundled.builtInLenses).sort()).toEqual([
      "conventions",
      "correctness",
      "spec-challenge",
    ])
  })
})

describe("severityOf", () => {
  const note = (forced = false): ReviewNote => ({
    id: "n",
    kind: "pointer",
    anchor: "a",
    before: "",
    text: "t",
    forced,
  })
  const ans = (o: Partial<Record<string, string>> = {}, p = 0.9) => {
    const base: Record<string, string> = {
      security: "no",
      reversibility: "two-way",
      blastRadius: "local",
      newConcept: "no",
      ...o,
    }
    return Object.fromEntries(Object.entries(base).map(([k, v]) => [`n.${k}`, { answer: v, p }]))
  }
  const j = (answers: ReturnType<typeof ans>, truncated: string[] = []) => ({ answers, truncated })

  it("security or one-way is critical and names each answer", () => {
    expect(severityOf(note(), j(ans({ security: "yes" })), 0.7)).toMatchObject({
      tier: "critical",
      reason: "critical: security",
    })
    expect(
      severityOf(note(), j(ans({ security: "yes", reversibility: "one-way" })), 0.7),
    ).toMatchObject({ tier: "critical", reason: "critical: security, one-way door", rank: 0 })
  })

  it("contract or new concept is should; neither is could", () => {
    expect(severityOf(note(), j(ans({ blastRadius: "contract" })), 0.7).tier).toBe("should")
    expect(severityOf(note(), j(ans({ newConcept: "yes" })), 0.7)).toMatchObject({
      tier: "should",
      reason: "should: new concept",
      rank: 1,
    })
    expect(severityOf(note(), j(ans()), 0.7)).toMatchObject({ tier: "could", rank: 2 })
  })

  it("unsure is critical: unanswered, unrecognised, cut, low p, blank floor", () => {
    const a = ans()
    delete (a as Record<string, unknown>)["n.security"]
    for (const x of [
      severityOf(note(), j(a), 0.7),
      severityOf(note(), j(ans({ security: "unsure" })), 0.7),
      severityOf(note(), j(ans(), ["n"]), 0.7),
      severityOf(note(), j(ans({}, 0.5)), 0.7),
      severityOf(note(), j(ans()), Infinity),
    ])
      expect(x).toMatchObject({ tier: "critical", reason: "critical: judge unsure" })
  })

  it("forced is critical regardless of answers", () => {
    expect(severityOf(note(true), j({}), 0.7)).toMatchObject({
      tier: "critical",
      reason: "critical: forced by `!`",
    })
  })
})

describe("severity routing", () => {
  const sev = (id: string, a: Record<string, string>): Record<string, JudgeAnswer> =>
    Object.fromEntries(Object.entries(a).map(([k, v]) => [`${id}.${k}`, verdict(v)]))
  const could = {
    security: "no",
    reversibility: "two-way",
    blastRadius: "local",
    newConcept: "no",
  }

  it("a forced note is asked nothing, not even the verdict, and is a critical edit", async () => {
    const run = await drive({ notes: ["! rename it — now", "sub"] })
    expect(run.judged.filter((id) => id.startsWith("note-1"))).toEqual([])
    expect(run.log).toContain("review.collecting")
    expect(run.prompts.get("review.collecting")).toContain("(critical: forced by `!`)")
  })

  it("a confident could edit defers and, alone, returns to the review gate", async () => {
    const run = await drive({
      notes: ["add — quote", "sub", "mul"],
      answers: { "note-1": verdict("edit"), ...sev("note-1", could) },
    })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.triage",
      "review.defer",
      "review.await-review",
    ])
  })

  it("severity answers on a nit leave it a nit", async () => {
    const run = await drive({
      notes: ["add — typo", "sub", "mul"],
      answers: { "note-1": verdict("nit"), ...sev("note-1", { reversibility: "one-way" }) },
    })
    expect(run.log).toContain("review.fix.nits.fixing")
    expect(run.log).not.toContain("review.collecting")
  })

  it("edits are captured critical before should, doors first, each labelled", async () => {
    const run = await drive({
      notes: ["add — plain", "sub — concept", "mul — door"],
      answers: {
        "note-1": verdict("edit"),
        ...sev("note-1", { ...could, security: "yes" }),
        ...sev("note-2", { ...could, newConcept: "yes" }),
        ...sev("note-3", { ...could, reversibility: "one-way" }),
      },
    })
    const capture = run.prompts.get("review.collecting") ?? ""
    const at = (id: string): number => capture.indexOf(`- ${id} —`)
    expect(at("note-3")).toBeLessThan(at("note-1"))
    expect(at("note-1")).toBeLessThan(at("note-2"))
    expect(capture).toContain("(critical: one-way door)")
    expect(capture).toContain("(should: new concept)")
    expect(capture).toContain("(critical: security)")
  })

  it("a round of only forced notes judges nothing and tiers each critical", async () => {
    const run = await drive({ notes: ["! rename it", "! drop it", "mul"] })
    expect(run.log).not.toContain("review.triage")
    expect(run.judged).toEqual([])
    expect(run.prompts.get("review.collecting")).toContain("(critical: forced by `!`)")
    expect(run.prompts.get("review.collecting")).not.toContain("! rename")
  })

  it("a note opening with != is not forced and keeps its text", async () => {
    const run = await drive({ notes: ["!= should be ===", "sub"] })
    expect(run.judged).toContain("note-1.security")
  })

  it("the gate after a deferral accepts a clean land and lists the deferred notes", async () => {
    const run = await drive({
      notes: ["add — quote", "sub", "mul"],
      answers: { "note-1": verdict("edit"), ...sev("note-1", could) },
    })
    expect(run.gates).toEqual([true, true])
    expect(run.gateMessages[1]).toContain("NOT acted on")
    expect(run.gateMessages[1]).toContain("note-1")
    expect(run.gateMessages[0]).not.toContain("NOT acted on")
  })

  it("the first round's gate accepts a clean land", async () => {
    const run = await drive({ notes: ["add", "sub", "mul"] })
    expect(run.gates.length).toBeGreaterThan(0)
    expect(run.gates.every((g) => g)).toBe(true)
  })

  it("a later gate still accepts a clean land after a deferral round with a nit", async () => {
    const run = await drive({
      notes: ["add — quote", "sub — typo", "mul"],
      answers: {
        "note-1": verdict("edit"),
        ...sev("note-1", could),
        "note-2": verdict("nit"),
      },
      reviewDocs: [undefined, doc(["add", "sub"])],
    })
    expect(run.log).toContain("review.defer")
    expect(run.log.at(-1)).toBe("review.await-review")
    expect(run.gates).toEqual([true, true])
  })

  it("a question and a could note in one round: the gate's base is the answering commit", async () => {
    const run = await drive({
      notes: ["add — why?", "sub — quote", "mul"],
      answers: {
        "note-1": verdict("question"),
        "note-2": verdict("edit"),
        ...sev("note-2", could),
      },
      passSecondGate: true,
    })
    expect(run.log).toEqual([
      "review.reviewing",
      "review.await-review",
      "review.triage",
      "review.answer-review-questions",
      "review.defer",
      "review.await-review",
    ])
    // c4 is the answering commit, not the defer commit (c5) or the round (c2)
    expect(run.since.at(-1)).toBe("c4")
  })

  it("a blank reviewSeverityMinP makes every confident could critical", async () => {
    const run = await drive({
      notes: ["add — quote", "sub", "mul"],
      answers: { "note-1": verdict("edit"), ...sev("note-1", could) },
      vars: { reviewSeverityMinP: "" },
    })
    expect(run.log).toContain("review.collecting")
    expect(run.log).not.toContain("review.defer")
  })
})
