import { describe, expect, it } from "vitest"
import { planStep } from "./planStep.js"
import { snapshot } from "./snapshot.fixture.js"

const commitTo = (from: string, to: string, actor = "human") =>
  ({
    kind: "commit",
    to,
    spec: { actor, from, to, step: { name: from, occurrence: 1 } },
  }) as const

describe("planStep — refusal and no-op pass through", () => {
  it("a refused landing becomes a refusal outcome", () => {
    const s = snapshot({
      state: "building",
      stepDef: {},
      landing: { kind: "refusal", message: "gtd land: nope" },
    })
    expect(planStep(s)).toEqual({ kind: "refusal", message: "gtd land: nope" })
  })

  it("a no-op keeps its settled flag", () => {
    const s = snapshot({ state: "gate", stepDef: {}, landing: { kind: "noop", settled: true } })
    expect(planStep(s)).toEqual({ kind: "noop", state: "gate", settled: true })
  })
})

describe("planStep — commit", () => {
  it("an attempt commits the subject with no step trailer and bypasses guards", () => {
    const s = snapshot({
      state: "await-answers",
      stepDef: { actor: "agent", kind: "prompt", mode: "qa" },
      actor: "agent",
      landing: { kind: "attempt", subject: "gtd(agent): await-answers" },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.to).toBe("await-answers")
    expect(outcome.steps).toEqual([
      {
        kind: "gitWrite",
        write: { kind: "commitAll", message: "gtd(agent): await-answers\n\nGtd-Format: 3" },
      },
      { kind: "outcome", outcome: { kind: "commit", subject: "gtd(agent): await-answers" } },
    ])
  })

  it("a transition commit carries the step trailer and reports both steps", () => {
    const s = snapshot({
      state: "building",
      stepDef: {},
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
      landing: commitTo("building", "done"),
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.subject).toBe("gtd(human): building → done")
    expect(outcome.steps[0]).toEqual({
      kind: "gitWrite",
      write: {
        kind: "commitAll",
        message: "gtd(human): building → done\n\nGtd-Step: building#1\nGtd-Format: 3",
      },
    })
    expect(outcome.steps.at(-1)).toEqual({
      kind: "outcome",
      outcome: { kind: "transition", from: "building", to: "done" },
    })
  })

  it("prepends `gtd uncheck` at the human review gate", () => {
    const s = snapshot({
      state: "await-review",
      stepDef: { mode: "review", file: ".gtd/REVIEW.md" },
      changes: [{ status: "M", path: "src/a.ts" }],
      landing: commitTo("await-review", "deciding"),
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.steps[0]).toEqual({ kind: "uncheck", file: ".gtd/REVIEW.md" })
  })

  it("records Gtd-Cost, then one Gtd-Judge per verdict", () => {
    const s = snapshot({ state: "a", stepDef: {}, landing: commitTo("a", "b", "judge") })
    const outcome = planStep(s, {
      cost: 1.5,
      model: "m",
      judge: [
        { id: "q1", answer: true, p: 0.9 },
        { id: "q2", answer: "x", p: 0.4 },
      ],
    })
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    const write = outcome.steps.find((step) => step.kind === "gitWrite")
    if (write?.kind !== "gitWrite" || write.write.kind !== "commitAll")
      throw new Error("expected a git write")
    const trailers = write.write.message.split("\n").slice(2)
    expect(trailers[0]).toBe("Gtd-Step: a#1")
    expect(trailers[1]).toBe("Gtd-Cost: 1.5 m")
    expect(trailers[2]).toBe('Gtd-Judge: {"id":"q1","answer":true,"p":0.9}')
    expect(trailers[3]).toBe('Gtd-Judge: {"id":"q2","answer":"x","p":0.4}')
    expect(trailers[4]).toBe("Gtd-Format: 3")
    expect(trailers).toHaveLength(5)
  })
})

describe("planStep — keepHistory", () => {
  it("writes the history ref right after the commit, before the outcome", () => {
    const s = snapshot({
      state: "building",
      stepDef: {},
      landing: { ...commitTo("building", "done"), keepHistory: "refs/gtd/history/abc" },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.steps.map((step) => step.kind)).toEqual(["gitWrite", "gitWrite", "outcome"])
    expect(outcome.steps[0]).toMatchObject({ write: { kind: "commitAll" } })
    expect(outcome.steps[1]).toEqual({
      kind: "gitWrite",
      write: { kind: "updateRef", ref: "refs/gtd/history/abc", target: "HEAD" },
    })
  })

  it("without keepHistory no updateRef is emitted", () => {
    const s = snapshot({ state: "building", stepDef: {}, landing: commitTo("building", "done") })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(
      outcome.steps.some((step) => step.kind === "gitWrite" && step.write.kind === "updateRef"),
    ).toBe(false)
  })
})

describe("planStep — approval landing", () => {
  const approved = { step: { name: "gate", occurrence: 1 }, name: "Ada", email: "ada@x.io" }

  it("commits with commitClean when the landing records an approval", () => {
    const base = commitTo("gate", "again")
    const s = snapshot({
      state: "gate",
      stepDef: {},
      landing: { ...base, spec: { ...base.spec, approved } },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.steps[0]).toMatchObject({ write: { kind: "commitClean" } })
  })

  it("a finishing approval still points the history ref after the commitClean write", () => {
    const base = commitTo("gate", "idle")
    const s = snapshot({
      state: "gate",
      stepDef: {},
      landing: { ...base, spec: { ...base.spec, approved }, keepHistory: "refs/gtd/history/abc" },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.steps.map((x) => (x.kind === "gitWrite" ? x.write.kind : x.kind))).toEqual([
      "commitClean",
      "updateRef",
      "outcome",
    ])
  })
})

describe("planStep — keepTurn", () => {
  const kept = "refs/gtd/kept/abc/building"

  it("emits keepTurn in place of commitAll, carrying the step's own commit message", () => {
    const s = snapshot({
      state: "building",
      stepDef: { actor: "agent", kind: "prompt" },
      actor: "agent",
      changes: [{ status: "A", path: "naive.txt" }],
      landing: { ...commitTo("building", "checking", "agent"), keepTurn: kept },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.steps.map((step) => step.kind)).toEqual(["gitWrite", "outcome"])
    expect(outcome.steps[0]).toEqual({
      kind: "gitWrite",
      write: {
        kind: "keepTurn",
        ref: kept,
        message: "gtd(agent): building → checking\n\nGtd-Step: building#1\nGtd-Format: 3",
      },
    })
  })

  it("a finishing keep landing points the history ref after the marker", () => {
    const s = snapshot({
      state: "building",
      stepDef: { actor: "agent", kind: "prompt" },
      actor: "agent",
      landing: {
        ...commitTo("building", "idle", "agent"),
        keepTurn: kept,
        keepHistory: "refs/gtd/history/abc",
      },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.steps.map((step) => step.kind)).toEqual(["gitWrite", "gitWrite", "outcome"])
    expect(outcome.steps[0]).toMatchObject({ write: { kind: "keepTurn" } })
    expect(outcome.steps[1]).toEqual({
      kind: "gitWrite",
      write: { kind: "updateRef", ref: "refs/gtd/history/abc", target: "HEAD" },
    })
  })

  it("without keepTurn the landing stays a commitAll", () => {
    const s = snapshot({ state: "building", stepDef: {}, landing: commitTo("building", "done") })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.steps[0]).toMatchObject({ write: { kind: "commitAll" } })
  })
})
