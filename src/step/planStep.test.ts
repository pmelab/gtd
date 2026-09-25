import { describe, expect, it } from "vitest"
import { planStep } from "./planStep.js"
import { snapshot } from "./snapshot.fixture.js"
import type { StateDef } from "../PatternMachine.js"

describe("planStep — refusal", () => {
  it("out-of-turn: invoker isn't the resting state's declared actor", () => {
    const stateDef: StateDef = { actor: "agent", script: "echo hi" }
    const s = snapshot({ state: "building", stateDef, actor: "human" })
    const outcome = planStep(s)
    expect(outcome).toEqual({
      kind: "refusal",
      message: 'gtd land: out of turn — "building" awaits agent',
    })
  })

  it("no-match: a dirty tree with no `on` row matching the pending changes", () => {
    const stateDef: StateDef = {
      actor: "human",
      script: "echo hi",
      on: [["C", "done"]],
    }
    const s = snapshot({
      state: "building",
      stateDef,
      changes: [{ status: "M", path: "src/a.ts" }],
    })
    const outcome = planStep(s)
    expect(outcome).toEqual({
      kind: "refusal",
      message:
        'gtd land: no declared pattern matches the pending changes at "building" — declared patterns: C',
    })
  })
})

describe("planStep — noop", () => {
  it("settles at a `script` rest with a clean tree and no `C` row", () => {
    const stateDef: StateDef = { actor: "human", script: "echo hi" }
    const s = snapshot({ state: "building", stateDef, changes: [] })
    const outcome = planStep(s)
    expect(outcome).toEqual({ kind: "noop", state: "building", settled: true })
  })

  it("does not settle at a `message` rest", () => {
    const stateDef: StateDef = { actor: "human", message: "hi" }
    const s = snapshot({ state: "gate", stateDef, changes: [] })
    const outcome = planStep(s)
    expect(outcome).toEqual({ kind: "noop", state: "gate", settled: false })
  })
})

describe("planStep — commit", () => {
  it("a self-loop commit (attempt) at a `prompt` rest bypasses guards", () => {
    const stateDef: StateDef = {
      actor: "agent",
      prompt: "do work",
      answerGate: true,
      mode: "qa",
    }
    const s = snapshot({ state: "await-answers", stateDef, actor: "agent", changes: [] })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    if (outcome.decision.kind !== "commit") throw new Error("expected a commit decision")
    expect(outcome.decision.attempt).toBe(true)
    expect(outcome.guardVerdict).toBeUndefined()
    expect(outcome.steps).toEqual([
      { kind: "gitWrite", write: { kind: "commitAll", message: outcome.decision.subject } },
      { kind: "outcome", outcome: { kind: "commit", subject: outcome.decision.subject } },
    ])
  })

  it("a transition commit reports both states in its outcome step", () => {
    const stateDef: StateDef = {
      actor: "human",
      script: "echo hi",
      on: [["* **", "done"]],
    }
    const s = snapshot({
      state: "building",
      stateDef,
      def: {
        states: {
          building: stateDef,
          done: { actor: "human", message: "done" },
        },
        entries: { default: "building", manual: [] },
      },
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    if (outcome.decision.kind !== "commit") throw new Error("expected a commit decision")
    expect(outcome.decision.to).toBe("done")
    expect(outcome.steps.at(-1)).toEqual({
      kind: "outcome",
      outcome: { kind: "transition", from: "building", to: "done" },
    })
    expect(outcome.guardVerdict).toBeUndefined()
  })

  it("carries a guard's refusal as `guardVerdict` without dropping the steps", () => {
    const stateDef: StateDef = {
      actor: "human",
      script: "echo hi",
      on: [["* **", "done"]],
      requireRevert: true,
    }
    const s = snapshot({
      state: "await-revert",
      stateDef,
      def: {
        states: { "await-revert": stateDef, done: { actor: "human", message: "done" } },
        entries: { default: "await-revert", manual: [] },
      },
      file: ".gtd/FILE.md",
      reviewBase: "abc123",
      startCommit: "def456",
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
      revert: { checked: true, base: "abc123~1", residue: ["src/a.ts"] },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.guardVerdict).toContain("src/a.ts still differ from abc123~1")
    expect(outcome.steps.length).toBeGreaterThan(0)
  })

  it("prepends `gtd uncheck` at the human review gate", () => {
    const stateDef: StateDef = {
      actor: "human",
      message: "review",
      mode: "review",
      on: [["* **", "done"]],
    }
    const s = snapshot({
      state: "await-review",
      stateDef,
      def: {
        states: { "await-review": stateDef, done: { actor: "human", message: "done" } },
        entries: { default: "await-review", manual: [] },
      },
      file: ".gtd/REVIEW.md",
      changes: [{ status: "M", path: ".gtd/REVIEW.md" }],
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    expect(outcome.steps[0]).toEqual({ kind: "uncheck", file: ".gtd/REVIEW.md" })
  })

  it("records a `Gtd-Cost:` trailer when `opts.cost` is given", () => {
    const stateDef: StateDef = { actor: "human", script: "echo hi", on: [["* **", "done"]] }
    const s = snapshot({
      state: "building",
      stateDef,
      def: {
        states: { building: stateDef, done: { actor: "human", message: "done" } },
        entries: { default: "building", manual: [] },
      },
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
    })
    const outcome = planStep(s, { cost: 10, model: "opus" })
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    const write = outcome.steps.find((st) => st.kind === "gitWrite")
    if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
    expect(write.write.message).toContain("Gtd-Cost: 10 opus")
  })

  it("records one Gtd-Judge: trailer line per verdict entry when opts.judge is given", () => {
    const stateDef: StateDef = { actor: "human", script: "echo hi", on: [["* **", "done"]] }
    const s = snapshot({
      state: "building",
      stateDef,
      def: {
        states: { building: stateDef, done: { actor: "human", message: "done" } },
        entries: { default: "building", manual: [] },
      },
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
    })
    const outcome = planStep(s, {
      judge: [
        { id: "q1", answer: true, p: 0.97 },
        { id: "q2", answer: "escalate", p: 0.6 },
      ],
    })
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    const write = outcome.steps.find((st) => st.kind === "gitWrite")
    if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
    expect(write.write.message).toContain('Gtd-Judge: {"id":"q1","answer":true,"p":0.97}')
    expect(write.write.message).toContain('Gtd-Judge: {"id":"q2","answer":"escalate","p":0.6}')
  })

  it("combines Gtd-Cost: and Gtd-Judge: trailers on the same commit, cost first", () => {
    const stateDef: StateDef = { actor: "human", script: "echo hi", on: [["* **", "done"]] }
    const s = snapshot({
      state: "building",
      stateDef,
      def: {
        states: { building: stateDef, done: { actor: "human", message: "done" } },
        entries: { default: "building", manual: [] },
      },
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
    })
    const outcome = planStep(s, {
      cost: 10,
      model: "opus",
      judge: [{ id: "q1", answer: true, p: 0.97 }],
    })
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    const write = outcome.steps.find((st) => st.kind === "gitWrite")
    if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
    const costIndex = write.write.message.indexOf("Gtd-Cost: 10 opus")
    const judgeIndex = write.write.message.indexOf('Gtd-Judge: {"id":"q1"')
    expect(costIndex).toBeGreaterThan(-1)
    expect(judgeIndex).toBeGreaterThan(costIndex)
  })

  it('records a `Gtd-Payload: {"truncated":true}` trailer when `opts.truncated` is true', () => {
    const stateDef: StateDef = { actor: "human", script: "echo hi", on: [["* **", "done"]] }
    const s = snapshot({
      state: "building",
      stateDef,
      def: {
        states: { building: stateDef, done: { actor: "human", message: "done" } },
        entries: { default: "building", manual: [] },
      },
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
    })
    const outcome = planStep(s, {
      judge: [{ id: "q1", answer: true, p: 0.97 }],
      truncated: true,
    })
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    const write = outcome.steps.find((st) => st.kind === "gitWrite")
    if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
    expect(write.write.message).toContain('Gtd-Payload: {"truncated":true}')
  })

  it("emits no `Gtd-Payload:` trailer when `opts.truncated` is false or omitted", () => {
    const stateDef: StateDef = { actor: "human", script: "echo hi", on: [["* **", "done"]] }
    const s = snapshot({
      state: "building",
      stateDef,
      def: {
        states: { building: stateDef, done: { actor: "human", message: "done" } },
        entries: { default: "building", manual: [] },
      },
      changes: [{ status: "M", path: ".gtd/FILE.md" }],
    })
    const opts = [
      { judge: [{ id: "q1", answer: true, p: 0.97 }], truncated: false },
      { judge: [{ id: "q1", answer: true, p: 0.97 }] },
    ] as const
    for (const opt of opts) {
      const outcome = planStep(s, opt)
      if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
      const write = outcome.steps.find((st) => st.kind === "gitWrite")
      if (write?.kind !== "gitWrite") throw new Error("expected a gitWrite step")
      expect(write.write.message).not.toContain("Gtd-Payload:")
    }
  })

  it("an answered verdict routes via the state's own `routes:`, overriding what `on:` alone would decide", () => {
    // `on:`'s only row ("C": "conservative") would land at "conservative" for
    // a clean tree — but a verdict was supplied this call, and the state
    // declares `routes:`, so the verdict decides instead.
    const stateDef: StateDef = {
      actor: "human",
      message: "verdict needed",
      judge: '{"questions":[{"id":"verdict"}]}',
      routes: [{ question: "verdict", is: "identical", to: "escalate" }, { to: "fix" }],
      on: [["C", "conservative"]],
    }
    const s = snapshot({
      state: "judging",
      stateDef,
      def: {
        states: {
          judging: stateDef,
          conservative: { actor: "human", message: "c" },
          fix: { actor: "human", message: "f" },
          escalate: { actor: "human", message: "e" },
        },
        entries: { default: "judging", manual: [] },
      },
      changes: [],
    })
    const outcome = planStep(s, { judge: [{ id: "verdict", answer: "identical", p: 0.95 }] })
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    if (outcome.decision.kind !== "commit") throw new Error("expected a commit decision")
    expect(outcome.decision.to).toBe("escalate")
  })

  it('a `noul` verdict\'s boolean answer routes against `is: "yes"`/`is: "no"` — the documented vocabulary, not `String(true)`', () => {
    // Every doc site (StateFields.ts's RouteRow/ROUTES_JSON_SCHEMA,
    // docs/configuration.md) tells an author a noul's `is:` is "yes"/"no".
    // `asRouteAnswers` must normalize the verdict's own boolean to match, or
    // a row written exactly as documented can never fire.
    const stateDef: StateDef = {
      actor: "human",
      message: "verdict needed",
      judge: '{"questions":[{"id":"confident"}]}',
      routes: [{ question: "confident", is: "yes", to: "proceed" }, { to: "escalate" }],
    }
    const def = {
      states: {
        judging: stateDef,
        proceed: { actor: "human", message: "p" },
        escalate: { actor: "human", message: "e" },
      },
      entries: { default: "judging", manual: [] },
    }
    const outcomeTrue = planStep(snapshot({ state: "judging", stateDef, def, changes: [] }), {
      judge: [{ id: "confident", answer: true, p: 0.95 }],
    })
    if (outcomeTrue.kind !== "commit" || outcomeTrue.decision.kind !== "commit") {
      throw new Error(`expected commit, got ${outcomeTrue.kind}`)
    }
    expect(outcomeTrue.decision.to).toBe("proceed")

    const outcomeFalse = planStep(snapshot({ state: "judging", stateDef, def, changes: [] }), {
      judge: [{ id: "confident", answer: false, p: 0.95 }],
    })
    if (outcomeFalse.kind !== "commit" || outcomeFalse.decision.kind !== "commit") {
      throw new Error(`expected commit, got ${outcomeFalse.kind}`)
    }
    expect(outcomeFalse.decision.to).toBe("escalate")
  })

  it("no `judge` opt at all (an ordinary `gtd land`) ignores `routes:` and uses the state's own `on:` — the skipped-judgment path", () => {
    const stateDef: StateDef = {
      actor: "human",
      message: "verdict needed",
      judge: '{"questions":[{"id":"verdict"}]}',
      routes: [{ question: "verdict", is: "identical", to: "escalate" }, { to: "fix" }],
      on: [["C", "conservative"]],
    }
    const s = snapshot({
      state: "judging",
      stateDef,
      def: {
        states: {
          judging: stateDef,
          conservative: { actor: "human", message: "c" },
          fix: { actor: "human", message: "f" },
          escalate: { actor: "human", message: "e" },
        },
        entries: { default: "judging", manual: [] },
      },
      changes: [],
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    if (outcome.decision.kind !== "commit") throw new Error("expected a commit decision")
    expect(outcome.decision.to).toBe("conservative")
  })
})

describe("planStep — Gtd-Each: snapshot trailer (Task 2)", () => {
  const eachDef = {
    states: {
      picking: { actor: "human", message: "pick", on: [["* *", "item.building"]] },
      "item.building": { actor: "agent", prompt: "build", on: [["A DONE.md", "drained"]] },
      drained: { actor: "human", message: "done" },
    },
    entries: { default: "picking", manual: [] },
    eachRefs: { item: { entry: "item.building", drained: "drained" } },
  } as const

  it("the entering commit carries a Gtd-Each: trailer naming the reference path and the JSON item list", () => {
    const s = snapshot({
      state: "picking",
      stateDef: eachDef.states.picking,
      def: eachDef,
      changes: [{ status: "M", path: "x" }],
      eachItems: { item: ["a", "b"] },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    const commitStep = outcome.steps.find((step) => step.kind === "gitWrite")
    if (commitStep?.kind !== "gitWrite" || commitStep.write.kind !== "commitAll") {
      throw new Error("expected a commitAll step")
    }
    expect(commitStep.write.message).toContain('Gtd-Each: item ["a","b"]')
  })

  it("an empty item list still writes a trailer with an empty array", () => {
    const s = snapshot({
      state: "picking",
      stateDef: eachDef.states.picking,
      def: eachDef,
      changes: [{ status: "M", path: "x" }],
      eachItems: { item: [] },
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    const commitStep = outcome.steps.find((step) => step.kind === "gitWrite")
    if (commitStep?.kind !== "gitWrite" || commitStep.write.kind !== "commitAll") {
      throw new Error("expected a commitAll step")
    }
    expect(commitStep.write.message).toContain("Gtd-Each: item []")
  })

  it("continuing WITHIN an already-entered item carries no Gtd-Each: trailer", () => {
    const s = snapshot({
      state: "item[0].building",
      stateDef: eachDef.states["item.building"],
      def: eachDef,
      changes: [{ status: "A", path: "DONE.md" }],
      eachItems: { item: ["a", "b"] },
      actor: "agent",
    })
    const outcome = planStep(s)
    if (outcome.kind !== "commit") throw new Error(`expected commit, got ${outcome.kind}`)
    const commitStep = outcome.steps.find((step) => step.kind === "gitWrite")
    if (commitStep?.kind !== "gitWrite" || commitStep.write.kind !== "commitAll") {
      throw new Error("expected a commitAll step")
    }
    expect(commitStep.write.message).not.toContain("Gtd-Each:")
  })
})
