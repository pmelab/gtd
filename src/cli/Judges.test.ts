import { describe, expect, it } from "vitest"
import {
  calibrate,
  criteriaChanged,
  findingsOf,
  processJudgments,
  whatIf,
  type JudgeCommit,
  type Judgment,
} from "./Judges.js"

let n = 0
const c = (
  subject: string,
  facts: Omit<JudgeCommit, "hash" | "message"> & { verdicts?: readonly object[] } = {},
): JudgeCommit => {
  const { verdicts = [], ...rest } = facts
  const trailers = verdicts.map((v) => `Gtd-Judge: ${JSON.stringify(v)}`).join("\n")
  return {
    hash: `c${++n}`,
    message: trailers === "" ? subject : `${subject}\n\n${trailers}`,
    ...rest,
  }
}

const identical = (p = 0.9) => ({ verdicts: [{ id: "verdict", answer: "identical", p }] })

describe("processJudgments — retry", () => {
  const red = (subject: string, report: string) => c(subject, { feedback: report })

  it("overturns identical when the next fix turn's check goes green", () => {
    const [j] = processJudgments([
      red("gtd(check): build.health.check → build.fix", "1 failing"),
      c("gtd(agent): build.fix → build.health.check"),
      red("gtd(check): build.health.check → build.health.judge", "1 failing again"),
      c("gtd(judge): build.health.judge → build.health.recheck", identical()),
      red("gtd(check): build.health.recheck → build.health.describe", "still"),
      c("gtd(agent): build.health.describe → build.health.stop"),
      c("gtd(human): build.health.stop → build.fix"),
      c("gtd(agent): build.fix → build.health.check"),
      c("gtd(check): build.health.check → build.quality"),
    ])
    expect(j).toMatchObject({
      judge: "retry",
      step: "build.health.judge",
      question: "verdict",
      outcome: "overturned",
      state: { previous: "1 failing", current: "1 failing again" },
    })
  })

  it("holds identical when that check stays red", () => {
    const [j] = processJudgments([
      c("gtd(judge): health.judge → health.recheck", identical()),
      red("gtd(check): health.recheck → health.describe", "x"),
      c("gtd(agent): fix → health.check"),
      red("gtd(check): health.check → health.judge", "x"),
    ])
    expect(j?.outcome).toBe("held")
  })

  it("has no outcome when a person edited code before the deciding check", () => {
    const [j] = processJudgments([
      c("gtd(judge): build.health.judge → build.health.recheck", identical()),
      red("gtd(check): build.health.recheck → build.health.describe", "x"),
      c("gtd(human): build.health.stop → build.fix", { code: true }),
      c("gtd(agent): build.fix → build.health.check"),
      c("gtd(check): build.health.check → idle"),
    ])
    expect(j?.outcome).toBeNull()
  })

  it("hands an empty report on as the flow does, and scores none of it", () => {
    const js = processJudgments([
      red("gtd(check): health.check → fix", " "),
      red("gtd(check): health.check → health.judge", "x"),
      c("gtd(judge): health.judge → fix", identical()),
      c("gtd(agent): fix → health.check"),
      c("gtd(check): health.check → idle"),
    ])
    expect(js[0]).toMatchObject({ state: { tailsNotComparable: "true" }, outcome: null })
    const w = whatIf(
      [{ vars: { judgeIdenticalMinP: "0.99" }, judgments: js }],
      "judgeIdenticalMinP",
      "0.5",
    )
    expect(w.changes).toEqual([])
  })

  it("has no outcome when the re-check passes before any fix, or for another answer", () => {
    const js = processJudgments([
      c("gtd(judge): build.health.judge → build.health.recheck", identical()),
      c("gtd(check): build.health.recheck → build.quality"),
      c("gtd(judge): build.health.judge → build.fix", {
        verdicts: [{ id: "verdict", answer: "progress", p: 0.9 }],
      }),
      c("gtd(agent): build.fix → build.health.check"),
      c("gtd(check): build.health.check → idle"),
    ])
    expect(js.map((j) => j.outcome)).toEqual([null, null])
  })
})

describe("processJudgments — triage", () => {
  const findings = findingsOf("## a stray export\n\nexport it\n\n## a missing test\n\nadd one\n")
  const composed = [
    "# Review: abc",
    "",
    "## Fixed automatically",
    "",
    "- a stray export (abc1234)",
    "",
    "## Dropped as noise",
    "",
    "- a missing test (p=0.85)",
    "",
  ].join("\n")
  const triage = c("gtd(judge): build.quality.triage → build.quality.sorting", {
    findings,
    verdicts: [
      { id: "Q1", answer: "mechanical", p: 0.95 },
      { id: "Q2", answer: "noise", p: 0.85 },
    ],
  })

  it("overturns a dropped finding the human wrote back on, holds the untouched fix", () => {
    const js = processJudgments([
      triage,
      c("gtd(check): build.review.composing → build.review.await", {
        review: { before: "", after: composed },
      }),
      c("gtd(human): build.review.await → build.review.triage", {
        review: {
          before: composed,
          after: composed.replace("(p=0.85)", "(p=0.85) — it is not noise"),
        },
      }),
    ])
    expect(js.map((j) => [j.question, j.outcome])).toEqual([
      ["Q1", "held"],
      ["Q2", "overturned"],
    ])
    expect(js[1]?.state).toEqual({ Q2: "## a missing test\n\nadd one" })
  })

  it("credits a written-back line to its own finding only", () => {
    const listed = [
      "# Review",
      "",
      "## Dropped as noise",
      "",
      "- a test (p=0.8)",
      "- a test for x (p=0.8)",
      "",
    ].join("\n")
    const js = processJudgments([
      c("gtd(judge): build.quality.triage → build.quality.sorting", {
        findings: findingsOf("## a test\n\n## a test for x\n"),
        verdicts: [
          { id: "Q1", answer: "noise", p: 0.8 },
          { id: "Q2", answer: "noise", p: 0.8 },
        ],
      }),
      c("gtd(human): build.review.await → build.review.triage", {
        review: { before: listed, after: listed.replace("x (p=0.8)", "x (p=0.8) — needed") },
      }),
    ])
    expect(js.map((j) => j.outcome)).toEqual(["held", "overturned"])
  })

  it("overturns a note written under the line, or a rewrite of it", () => {
    const listed = "# R\n\n## Dropped as noise\n\n- a test (p=0.8)\n- b (p=0.8)\n"
    const triaged = (after: string) =>
      processJudgments([
        c("gtd(judge): build.quality.triage → build.quality.sorting", {
          findings: findingsOf("## a test\n\n## b\n"),
          verdicts: [
            { id: "Q1", answer: "noise", p: 0.8 },
            { id: "Q2", answer: "noise", p: 0.8 },
          ],
        }),
        c("gtd(human): build.review.await → build.review.triage", {
          review: { before: listed, after },
        }),
      ]).map((j) => j.outcome)
    expect(triaged(listed.replace("(p=0.8)\n", "(p=0.8)\n  we need it\n"))).toEqual([
      "overturned",
      "held",
    ])
    expect(triaged(listed.replace("- a test (p=0.8)", "- a test: not noise"))).toEqual([
      "overturned",
      "held",
    ])
  })

  it("scores only a finding the review listed as fixed or dropped", () => {
    const js = processJudgments([
      c("gtd(judge): build.quality.triage → build.quality.sorting", {
        findings,
        verdicts: [
          { id: "Q1", answer: "mechanical", p: 0.95 },
          { id: "Q2", answer: "design", p: 0.95 },
        ],
      }),
      c("gtd(human): build.review.await → idle", {
        review: { before: "# Review\n\n## a stray export\n\nleft\n", after: "# Review\n" },
      }),
    ])
    expect(js.map((j) => j.outcome)).toEqual([null, null])
  })
})

describe("processJudgments — clear", () => {
  const clear = (answer: unknown) =>
    c("gtd(judge): design.clear → design.normalise", {
      sketch: "# TODO\n",
      verdicts: [{ id: "clear", answer, p: 0.9 }],
    })

  it("overturns a skip a later design gate edited the criteria after", () => {
    const [j] = processJudgments([
      clear("yes"),
      c("gtd(agent): design.triage → design.answer-product-questions", { criteriaChanged: true }),
      c("gtd(human): design.answer-product-questions → design.triage", { criteriaChanged: true }),
    ])
    expect(j).toMatchObject({
      judge: "clear",
      outcome: "overturned",
      state: { sketch: "# TODO\n" },
    })
  })

  it("holds a skip no gate edited after, reading a boolean verdict as yes", () => {
    const [j] = processJudgments([
      clear(true),
      c("gtd(agent): design.triage → design.answer-product-questions", { criteriaChanged: true }),
      c("gtd(human): build.review.await → idle"),
    ])
    expect(j?.outcome).toBe("held")
  })

  it("has no outcome for a no, or a yes below the skip floor", () => {
    expect(processJudgments([clear("no")])[0]?.outcome).toBeNull()
    const low = c("gtd(judge): design.clear → design.triage", {
      verdicts: [{ id: "clear", answer: "yes", p: 0.75 }],
    })
    expect(processJudgments([low])[0]?.outcome).toBeNull()
  })
})

describe("findingsOf", () => {
  it("numbers stray prose first, as the quality lap does", () => {
    expect(findingsOf("just prose\n\n## one\n\nbody\n").map((f) => [f.id, f.title])).toEqual([
      ["Q1", "Quality findings"],
      ["Q2", "one"],
    ])
  })
})

describe("criteriaChanged", () => {
  const doc = (items: string) => `# R\n\n## Acceptance Criteria\n\n${items}\n\n## Notes\n\nx\n`

  it("ignores rewrapping and edits outside the criteria", () => {
    expect(criteriaChanged(doc("- AC-1: a b"), doc("- AC-1: a\n  b").replace("x", "y"))).toBe(false)
    expect(criteriaChanged(doc("- AC-1: a"), doc("- AC-1: a\n- AC-2: b"))).toBe(true)
    expect(criteriaChanged(undefined, doc("- AC-1: a"))).toBe(true)
    expect(criteriaChanged(doc("- AC-1: a"), doc("Settled.\n\n- AC-1: a"))).toBe(false)
  })
})

const judgment = (over: Partial<Judgment>): Judgment => ({
  judge: "triage",
  commit: "c",
  step: "build.quality.triage",
  question: "Q1",
  state: {},
  answer: "noise",
  p: 0.8,
  outcome: null,
  ...over,
})

describe("calibrate", () => {
  it("buckets scored verdicts by tenths of p, 1 in the top bucket", () => {
    const { triage, retry } = calibrate([
      judgment({ p: 0.85, outcome: "overturned" }),
      judgment({ p: 0.8, outcome: "held" }),
      judgment({ p: 1, outcome: "held" }),
      judgment({ p: 0.5 }),
    ])
    expect(triage).toEqual({
      verdicts: 4,
      scored: 3,
      overturned: 1,
      buckets: [
        { p: 0.8, scored: 2, overturned: 1, rate: 0.5 },
        { p: 0.9, scored: 1, overturned: 0, rate: 0 },
      ],
    })
    expect(retry).toEqual({ verdicts: 0, scored: 0, overturned: 0, buckets: [] })
  })
})

describe("whatIf", () => {
  it("re-decides each verdict under its process's recorded threshold and the new one", () => {
    const w = whatIf(
      [
        {
          vars: { qualityTriageMinP: "0.7" },
          judgments: [
            judgment({ p: 0.85, outcome: "overturned" }),
            judgment({ p: 0.8 }),
            judgment({ answer: "mechanical", p: 0.95 }),
            judgment({ judge: "retry", answer: "identical", p: 0.8 }),
          ],
        },
      ],
      "qualityTriageMinP",
      "0.9",
    )
    expect(w).toEqual({
      var: "qualityTriageMinP",
      value: "0.9",
      judge: "triage",
      changes: [{ from: "noise", to: "design", count: 2, overturned: 1 }],
    })
  })

  it("leaves out a process that recorded no such threshold", () => {
    const w = whatIf(
      [{ vars: {}, judgments: [judgment({ judge: "retry", answer: "identical", p: 0.8 })] }],
      "judgeIdenticalMinP",
      "0.7",
    )
    expect(w.changes).toEqual([])
  })
})
