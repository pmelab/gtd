import { afterEach, describe, expect, it } from "vitest"
import {
  installContext,
  type Change,
  type JudgeAnswer,
  type JudgeQuestion,
  type ScopeOptions,
  type StepRequest,
} from "../../flows/index.js"
import {
  buildTail,
  humanReview,
  reUnwind,
  severityOf,
  type BuildTailOptions,
  type ReviewOutcome,
} from "./review.js"
import type { ReviewNote } from "../../steering/index.js"
import * as bundled from "../index.js"
import { fixtureContext } from "./text.fixture.js"
import { toRequest } from "../../judges/index.js"

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
  /** The REVIEW.md each `review.composing` turn writes, in order; also raises the review-turn stop to one past the last. */
  readonly reviewDocs?: readonly (string | undefined)[]
  /** Let the run pass the second gate, stopping at the first range read after it. */
  readonly passSecondGate?: boolean
  /** Options as `buildTail` passes them; `guard` is logged as `guard` when it runs. */
  readonly options?: Omit<BuildTailOptions, "guard">
  /** Install a guard that logs `guard` into the step log. */
  readonly guarded?: boolean
  /** The pending changes `changes()` reports at the collecting turn. */
  readonly pending?: readonly Change[]
  /** Files the harness holds from the start. */
  readonly files?: Readonly<Record<string, string>>
}

interface Run {
  readonly log: string[]
  readonly prompts: Map<string, string>
  readonly result: ReviewOutcome | "stopped"
  readonly judged: readonly string[]
  readonly asked: readonly JudgeQuestion[]
  /** `acceptClean` of each `review.await-review` gate, in order. */
  readonly gates: readonly boolean[]
  readonly gateMessages: readonly string[]
  /** Every `changesSince` argument, in order. */
  readonly since: readonly string[]
  /** Every scope opened, in order. */
  readonly scopes: readonly ScopeOptions[]
}

/** Run `review` against a scripted context; a second pass at the gate or a fresh review stops the run. */
const drive = async (d: Drive): Promise<Run> => {
  const log: string[] = []
  const prompts = new Map<string, string>()
  const asked: JudgeQuestion[] = []
  const gates: boolean[] = []
  const gateMessages: string[] = []
  const since: string[] = []
  const scopes: ScopeOptions[] = []
  const files = new Map<string, string>([
    [REVIEW, d.after ?? doc(d.notes)],
    ...Object.entries(d.files ?? {}),
  ])
  let steps = 0
  let nitsFixed = false
  let awaits = 0
  let reviews = 0
  const effects: Record<string, () => void> = {
    "review.composing": () => {
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
    if (request.kind === "run") prompts.set(request.name, request.body)
    if (request.kind === "judge") asked.push(...request.questions)
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
      pushScope: (scope) => void scopes.push(scope),
      popScope: () => undefined,
      read: (path) => files.get(path),
      changes: (): readonly Change[] => d.pending ?? [],
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
    result = await humanReview("base", undefined, {
      ...d.options,
      ...(d.guarded ? { guard: () => void log.push("guard") } : {}),
    })
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    result = "stopped"
  }
  return {
    log,
    prompts,
    result,
    judged: asked.map((q) => q.id),
    asked,
    gates,
    gateMessages,
    since,
    scopes,
  }
}

const verdict = (answer: string, p = 0.9): JudgeAnswer => ({ answer, p })

describe("the risk-fix pass", () => {
  const risky = doc(["Risk: drops the carry", "sub"])
  const clean = doc(["add — fine", "sub"])

  it("a marked risk is fixed, kept green, re-reviewed, then rests at the gate", async () => {
    const run = await drive({ notes: [], reviewDocs: [risky, clean] })
    expect(run.log.slice(0, 5)).toEqual([
      "review.composing",
      "review.fix.risks.fixing",
      "health.check",
      "review.composing",
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
      "review.composing",
      "review.fix.risks.fixing",
      "health.check",
      "review.composing",
      "review.await-review",
    ])
  })

  it("fixAccess wraps both fix turns in their own scope, the step names unchanged", async () => {
    const fixAccess = { write: ["src/a.ts", ".gtd/**"] }
    const run = await drive({
      notes: ["add — typo", "sub", "mul"],
      answers: { "note-1": verdict("nit") },
      reviewDocs: [risky, clean],
      options: { fixAccess },
    })
    expect(run.scopes).toEqual([
      { name: "review.fix.risks", access: fixAccess },
      { name: "review.fix.nits", access: fixAccess },
    ])
    // The harness pushes no scope names, so the step is relative to its own fix scope.
    expect(run.log.filter((n) => n === "fixing")).toHaveLength(2)
  })

  it("without fixAccess the fix turns open no scope", async () => {
    const run = await drive({ notes: [], reviewDocs: [risky, clean] })
    expect(run.log).toContain("review.fix.risks.fixing")
    expect(run.scopes).toEqual([])
  })

  it("no marker means no fix-risks step", async () => {
    const run = await drive({ notes: [], reviewDocs: [clean] })
    expect(run.log).not.toContain("review.fix.risks.fixing")
    expect(run.log[0]).toBe("review.composing")
    expect(run.log[1]).toBe("review.await-review")
  })

  it("a nit re-review round gets its own single pass", async () => {
    const run = await drive({
      notes: ["add — typo", "sub", "mul"],
      answers: { "note-1": verdict("nit") },
      reviewDocs: [undefined, risky, clean],
    })
    expect(run.log).toEqual([
      "review.composing",
      "review.await-review",
      "review.triage",
      "review.fix.nits.fixing",
      "health.check",
      "review.closing",
      "review.composing",
      "review.fix.risks.fixing",
      "health.check",
      "review.composing",
      "review.await-review",
    ])
  })
})

describe("the guard", () => {
  const risky = doc(["Risk: drops the carry", "sub"])
  const clean = doc(["add — fine", "sub"])

  it("runs right after the risk-fix turn", async () => {
    const run = await drive({ notes: [], reviewDocs: [risky, clean], guarded: true })
    expect(run.log.slice(0, 4)).toEqual([
      "review.composing",
      "review.fix.risks.fixing",
      "guard",
      "health.check",
    ])
  })

  it("runs right after the nit-fix turn", async () => {
    const run = await drive({
      notes: ["add — typo", "sub", "mul"],
      answers: { "note-1": verdict("nit") },
      guarded: true,
    })
    expect(run.log.slice(2, 6)).toEqual([
      "review.triage",
      "review.fix.nits.fixing",
      "guard",
      "health.check",
    ])
  })
})

describe("the feedback target", () => {
  const edit = ["add — rename it", "sub", "mul"]
  const REFACTOR = ".gtd/REFACTOR.md"

  it("defaults to .gtd/REQUIREMENTS.md via the review.collecting step", async () => {
    const run = await drive({ notes: edit })
    expect(run.log.at(-1)).toBe("review.collecting")
    expect(run.result).toMatchObject({ verdict: "feedback" })
  })

  it("file replaces .gtd/REQUIREMENTS.md as the feedback test", async () => {
    let collected = ""
    const run = await drive({
      notes: edit,
      options: {
        feedback: {
          file: REFACTOR,
          collecting: (capture) => {
            collected = capture
            return Promise.resolve()
          },
          unmatched: "unmatched: refactor",
        },
      },
      files: { [REFACTOR]: "## Concern" },
    })
    expect(collected).toContain("rename it")
    expect(run.log).not.toContain("review.collecting")
    expect(run.result).toMatchObject({ verdict: "feedback" })
  })

  it("a collecting turn that wrote REQUIREMENTS but not file signs off unrefused with nothing changed", async () => {
    const run = await drive({
      notes: edit,
      options: {
        feedback: {
          file: REFACTOR,
          collecting: () => Promise.resolve(),
          unmatched: "unmatched: refactor",
        },
      },
    })
    expect(run.result).toEqual({ verdict: "signoff" })
  })

  it("a feature review edit note collected to nothing signs off", async () => {
    const run = await drive({
      notes: edit,
      options: {
        feedback: {
          file: REQUIREMENTS,
          collecting: () => Promise.resolve(),
          unmatched: "unmatched",
        },
      },
    })
    expect(run.result).toEqual({ verdict: "signoff" })
  })

  it("dropped is passed through as the refusal for a round collected to nothing", async () => {
    await expect(
      drive({
        notes: edit,
        options: {
          feedback: {
            file: REFACTOR,
            collecting: () => Promise.resolve(),
            unmatched: "unmatched: refactor",
            dropped: (r) => `dropped: ${r.notes.map((n) => n.id).join(",")}`,
          },
        },
      }),
    ).rejects.toThrow("dropped: note-1")
  })

  it("refuses with unmatched when the collecting turn changed something but not file", async () => {
    await expect(
      drive({
        notes: edit,
        options: {
          feedback: {
            file: REFACTOR,
            collecting: () => Promise.resolve(),
            unmatched: "unmatched: refactor",
          },
        },
        pending: [{ path: "src/x.ts", status: "modified", before: "a", after: "b" }],
      }),
    ).rejects.toThrow("unmatched: refactor")
  })
})

describe("reUnwind", () => {
  it("restores edited paths from restoreFrom and removes added ones, in the caller's scope", async () => {
    const steps: StepRequest[] = []
    installContext(
      fixtureContext(
        {},
        {
          step: (request) => {
            steps.push(request)
            return Promise.resolve()
          },
          read: (path) => (path === "src/a.ts" ? "old" : undefined),
        },
      ),
    )
    await reUnwind({
      verdict: "feedback",
      base: "b1",
      restoreFrom: "r1",
      edited: [
        { path: "src/a.ts", status: "modified", before: "old", after: "new" },
        { path: "src/new.ts", status: "added", before: undefined, after: "x" },
      ],
    })
    const [step] = steps
    expect(step).toMatchObject({ kind: "run", name: "re-unwind" })
    const body = step?.kind === "run" ? step.body : ""
    expect(body).toContain("git restore --source='r1' --worktree -- 'src/a.ts'")
    expect(body).toContain("rm -f -- 'src/new.ts'")
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

  it("asks only questions sendable to jev, each choice with its labels", async () => {
    const run = await drive({ notes: ["add — a"] })
    const { questions } = toRequest(run.asked, {})
    const labels = (id: string) => Object.keys((questions[id] as { criteria: object }).criteria)
    expect(labels("note-1")).toEqual(["edit", "question", "nit", "praise"])
    expect(labels("note-1.reversibility")).toEqual(["one-way", "two-way"])
    expect(labels("note-1.blastRadius")).toEqual(["local", "module", "contract"])
  })

  it("an unanswered note counts as edit", async () => {
    const run = await drive({ notes: ["add — typo", "sub", "mul"], answers: {} })
    expect(run.log).toEqual([
      "review.composing",
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
      "review.composing",
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
      "review.composing",
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
      "review.composing",
      "review.await-review",
      "review.triage",
      "review.answer-review-questions",
      "review.fix.nits.fixing",
      "health.check",
      "review.closing",
      "review.composing",
    ])
    expect(run.prompts.get("review.fix.nits.fixing")).not.toContain("why?")
    expect(run.prompts.get("review.composing")).toContain("git show 'c4:.gtd/REVIEW.md'")
    expect(run.result).toBe("stopped")
  })

  it("nits alone carry nothing over", async () => {
    const run = await drive({
      notes: ["add — typo", "sub", "mul"],
      answers: { "note-1": verdict("nit") },
    })
    expect(run.prompts.get("review.composing")).not.toContain("git show")
    expect(run.prompts.get("review.composing")).toContain("## Fixed from your notes")
  })

  it("edits run after questions and nits, and the capture names only the edits and the answering commit", async () => {
    const run = await drive({
      notes: ["add — rename it", "sub — why?", "mul — typo"],
      answers: { "note-2": verdict("question"), "note-3": verdict("nit") },
    })
    expect(run.log).toEqual([
      "review.composing",
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
      "review.composing",
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
  it("are the seven lenses in the settled order", () => {
    expect(bundled.defaults.qualityReviews!.split(",").map((l) => l.trim())).toEqual([
      "correctness",
      "owasp-security",
      "ponytail-review",
      "test-audit",
      "conventions",
      "spec-challenge",
      "criteria-coverage",
    ])
  })

  it("expose builtInLenses through the public workflow module", () => {
    expect(Object.keys(bundled.builtInLenses).sort()).toEqual([
      "conventions",
      "correctness",
      "criteria-coverage",
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

  it("a confident could edit is still re-planned, labelled could", async () => {
    const run = await drive({
      notes: ["add — quote", "sub", "mul"],
      answers: { "note-1": verdict("edit"), ...sev("note-1", could) },
    })
    expect(run.log).toEqual([
      "review.composing",
      "review.await-review",
      "review.triage",
      "review.closing",
      "review.collecting",
    ])
    expect(run.prompts.get("review.collecting")).toContain("(could)")
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

  it("the first round's gate accepts a clean land", async () => {
    const run = await drive({ notes: ["add", "sub", "mul"] })
    expect(run.gates.length).toBeGreaterThan(0)
    expect(run.gates.every((g) => g)).toBe(true)
  })

  it("a blank reviewSeverityMinP makes every confident could critical", async () => {
    const run = await drive({
      notes: ["add — quote", "sub", "mul"],
      answers: { "note-1": verdict("edit"), ...sev("note-1", could) },
      vars: { reviewSeverityMinP: "" },
    })
    expect(run.prompts.get("review.collecting")).toContain("(critical: judge unsure)")
  })
})

describe("BuildTailOptions.lensBase", () => {
  const lensPrompts = async (
    options: BuildTailOptions,
    call: () => Promise<unknown> = () => buildTail("base", { ...options, green: true }),
  ): Promise<string[]> => {
    const prompts: string[] = []
    installContext(
      fixtureContext(
        { vars: { qualityReviews: "conventions, correctness" } },
        {
          step: (request: StepRequest) => {
            if (request.kind === "restart") return Promise.resolve()
            if (request.kind === "agent" && request.name.startsWith("quality."))
              prompts.push(request.prompt)
            if (request.name === "review.composing") throw new Stop()
            return Promise.resolve()
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          changesSince: () => {
            throw new Stop()
          },
          start: () => "START-SHA",
        },
      ),
    )
    await call().catch((error: unknown) => {
      if (!(error instanceof Stop)) throw error
    })
    return prompts
  }

  it("reaches every quality-lens prompt", async () => {
    const prompts = await lensPrompts({ lensBase: "LENS-BASE" })
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).toContain("from `LENS-BASE`")
  })

  it("absent, the lens prompts name start()", async () => {
    const prompts = await lensPrompts({})
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).toContain("from `START-SHA`")
  })

  it("the deprecated positional form runs the same tail as the options form", async () => {
    const options = { lensBase: "LENS-BASE" }
    const modern = await lensPrompts(options)
    const legacy = await lensPrompts(options, () => buildTail(false, "base", true, options))
    expect(legacy).toEqual(modern)
    expect(legacy).toHaveLength(2)
  })

  describe("buildTail flags", () => {
    const requestNames = async (
      call: () => Promise<unknown>,
      names: string[] = [],
    ): Promise<string[]> => {
      installContext(
        fixtureContext(
          {},
          {
            step: (request: StepRequest) => {
              if (request.kind === "restart") return Promise.resolve()
              names.push(`${request.kind}:${request.name}`)
              if (names.length >= 4) throw new Stop()
              return Promise.resolve()
            },
            pushScope: () => undefined,
            popScope: () => undefined,
            changesSince: () => {
              throw new Stop()
            },
            start: () => "START-SHA",
          },
        ),
      )
      await call().catch((error: unknown) => {
        if (!(error instanceof Stop)) throw error
      })
      return names
    }

    for (const [fixFirst, green] of [
      [true, false],
      [true, true],
      [false, true],
      [false, false],
    ] as const) {
      it(`fixFirst ${fixFirst}, green ${green} match the options form`, async () => {
        const modern = await requestNames(() => buildTail("base", { fixFirst, green }))
        const legacy = await requestNames(() => buildTail(fixFirst, "base", green))
        expect(legacy).toEqual(modern)
      })
    }

    it("fixFirst and green each change the request sequence", async () => {
      const seq = (fixFirst: boolean, green: boolean) =>
        requestNames(() => buildTail(fixFirst, "base", green))
      const base = await seq(false, false)
      expect(await seq(true, false)).not.toEqual(base)
      expect(await seq(false, true)).not.toEqual(base)
    })

    for (const bad of [undefined, null, 1, {}]) {
      it(`rejects naming both forms for sole first argument ${String(bad)}`, async () => {
        const names: string[] = []
        const rejected = expect(requestNames(() => buildTail(bad as never), names)).rejects
        await rejected.toThrow("buildTail(base, options?)")
        await rejected.toThrow("buildTail(fixFirst, base, green?, options?)")
        expect(names).toEqual([])
      })
    }

    it("rejects an undefined first argument followed by an options object", async () => {
      const names: string[] = []
      const rejected = expect(
        requestNames(() => buildTail(undefined as never, { green: true } as never), names),
      ).rejects
      await rejected.toThrow("buildTail(base, options?)")
      await rejected.toThrow("buildTail(fixFirst, base, green?, options?)")
      expect(names).toEqual([])
    })

    const fitsNeither: [string, () => Promise<unknown>][] = [
      ["a boolean with no base", () => buildTail(true as never)],
      ["false followed by an options object", () => buildTail(false as never, {} as never)],
      ["a base followed by a boolean", () => buildTail("base", true as never)],
      ["a base followed by a string array", () => buildTail("base", ["x"] as never)],
      [
        "a base with a third argument",
        () => (buildTail as (...args: unknown[]) => Promise<unknown>)("base", {}, true),
      ],
      ["a number followed by a base", () => buildTail(1 as never, "base")],
      ["a string fixFirst followed by a base", () => buildTail("x" as never, "base")],
      ["a legacy call with a non-boolean green", () => buildTail(false, "base", 1 as never)],
      ["a legacy call with non-object options", () => buildTail(false, "base", true, 1 as never)],
      ["a base followed by a Promise", () => buildTail("base", Promise.resolve({}) as never)],
      [
        "a base with a fifth argument",
        () =>
          (buildTail as (...args: unknown[]) => Promise<unknown>)(
            "base",
            {},
            undefined,
            undefined,
            {},
          ),
      ],
      [
        "a legacy call with a fifth argument",
        () => (buildTail as (...args: unknown[]) => Promise<unknown>)(false, "base", true, {}, {}),
      ],
    ]
    for (const [label, call] of fitsNeither) {
      it(`rejects ${label} before any step runs`, async () => {
        const names: string[] = []
        const rejected = expect(requestNames(call, names)).rejects
        await rejected.toThrow("buildTail(base, options?)")
        await rejected.toThrow("buildTail(fixFirst, base, green?, options?)")
        expect(names).toEqual([])
      })
    }

    it("reads null and trailing undefined arguments as absent", async () => {
      const omitted = await requestNames(() => buildTail("base"))
      expect(await requestNames(() => buildTail(null as never, "base", null as never))).toEqual(
        omitted,
      )
      expect(
        await requestNames(() =>
          (buildTail as (...args: unknown[]) => Promise<unknown>)(
            "base",
            {},
            null,
            undefined,
            null,
          ),
        ),
      ).toEqual(omitted)
      expect(await requestNames(() => buildTail("base", null as never))).toEqual(omitted)
      expect(await requestNames(() => buildTail(false, "base", false, null as never))).toEqual(
        omitted,
      )
    })

    it("accepts a class instance as options", async () => {
      class Options {
        green = true
      }
      expect(await requestNames(() => buildTail("base", new Options()))).toEqual(
        await requestNames(() => buildTail("base", { green: true })),
      )
    })

    it("accepts a null-prototype options object", async () => {
      expect(await requestNames(() => buildTail("base", Object.create(null) as never))).toEqual(
        await requestNames(() => buildTail("base")),
      )
    })

    it("still runs buildTail(undefined, base) as a legacy call", async () => {
      const names: string[] = []
      await requestNames(() => buildTail(undefined as never, "base"), names)
      expect(names).not.toEqual([])
    })

    // pins `| undefined` on every BuildTailOptions field under exactOptionalPropertyTypes (typecheck)
    it("explicitly undefined options default like omitted ones", async () => {
      expect(
        await requestNames(() =>
          buildTail("base", {
            fixFirst: undefined,
            green: undefined,
            guard: undefined,
            guardRests: undefined,
            lenses: undefined,
            feedback: undefined,
            fixAccess: undefined,
            lensBase: undefined,
            rules: undefined,
            lap: undefined,
          }),
        ),
      ).toEqual(await requestNames(() => buildTail("base")))
    })
  })
})

// pins the public re-exports from the published workflows entry
export type _PublicBuildTailOptions = [
  bundled.BuildTailOptions,
  bundled.FeedbackTarget,
  bundled.ReviewRange,
  bundled.TailOptions,
]

describe("buildTail without rules", () => {
  const RULES = "Change only these paths"

  const tailPrompts = async (reds: number): Promise<Map<string, string>> => {
    const prompts = new Map<string, string>()
    let checks = 0
    const files = new Map<string, string>([[".gtd/QUALITY.md", "- finding"]])
    installContext(
      fixtureContext(
        { vars: { qualityReviews: "conventions" } },
        {
          step: (request: StepRequest) => {
            if (request.kind === "restart") return Promise.resolve()
            if (request.kind === "agent") prompts.set(request.name, request.prompt)
            if (request.name === "health.check") checks++
            if (request.name === "fix.quality.fixing") files.delete(".gtd/QUALITY.md")
            if (request.name === "review.composing" || request.name === "health.stop")
              throw new Stop()
            return Promise.resolve(
              request.kind === "judge"
                ? { answers: { Q1: { answer: "mechanical", p: 0.9 } }, truncated: [] }
                : undefined,
            )
          },
          pushScope: () => undefined,
          popScope: () => undefined,
          read: (path) =>
            path === ".gtd/FEEDBACK.md" ? (checks <= reds ? "red" : undefined) : files.get(path),
          changes: () =>
            checks <= reds
              ? [{ path: ".gtd/FEEDBACK.md", status: "added", before: undefined, after: "red" }]
              : [],
          matches: (path, pattern) => path === pattern,
          changesSince: () => {
            throw new Stop()
          },
          start: () => "c0",
        },
      ),
    )
    await buildTail("base", { fixFirst: true }).catch((error: unknown) => {
      if (!(error instanceof Stop)) throw error
    })
    return prompts
  }

  it("renders the feature tail's fix and describe prompts unchanged", async () => {
    const prompts = await tailPrompts(6)
    expect(prompts.get("fix")).toMatch(/- Leave everything uncommitted — do not commit\n$/)
    expect(prompts.get("health.describe")).toMatch(/this turn only writes the document\n$/)
    for (const prompt of prompts.values()) expect(prompt).not.toContain(RULES)
  })

  it("renders the feature tail's quality-fix prompt unchanged", async () => {
    const prompts = await tailPrompts(0)
    expect(prompts.get("fix.quality.fixing")).toMatch(
      /- Leave everything else uncommitted and finish your turn\n$/,
    )
    expect(prompts.get("fix.quality.fixing")).not.toContain(RULES)
  })

  it("renders the risk-fix and nit-fix prompts unchanged", async () => {
    const run = await drive({
      notes: [],
      reviewDocs: [doc(["Risk: x", "sub"]), doc(["add", "sub"])],
    })
    expect(run.prompts.get("review.fix.risks.fixing")).toContain("add a test that fails")
    expect(run.prompts.get("review.fix.risks.fixing")).not.toContain(RULES)
    const nits = await drive({
      notes: ["add — typo", "sub", "mul"],
      answers: { "note-1": verdict("nit") },
    })
    expect(nits.prompts.get("review.fix.nits.fixing")).not.toContain(RULES)
  })
})
