import { describe, expect, it } from "vitest"
import { buildSummary } from "./Summary.js"
import type { ProcessRun, TraceEntry } from "./Edge.js"
import type { WorkflowDefinition } from "./PatternMachine.js"
import type { TemplateContext } from "./PatternTemplates.js"

const baseContext = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  startCommit: "aaa111",
  currentCommit: "ccc333",
  previousCommit: "bbb222",
  state: "idle",
  actor: "human",
  reviewBase: "rev999",
  processBase: "ret888",
  processCost: 0,
  processCostByModel: [],
  read: (path: string) => `contents of ${path}`,
  diff: (base: string) => `diff of ${base}`,
  sections: () => [],
  openQuestions: () => [],
  openQuestionOptions: () => [],
  vars: {},
  edges: [],
  ...overrides,
})

const def = (summary?: string): WorkflowDefinition => ({
  states: {},
  entries: { default: "idle", manual: [] },
  ...(summary !== undefined ? { summary } : {}),
})

const trace = (entries: readonly TraceEntry[]): ProcessRun => ({
  startHash: entries[0]?.hash ?? "",
  startParentHash: "",
  diffBase: "",
  trace: entries,
  costEntries: [],
  judgeVerdicts: [],
  entryVars: {},
  headTurn: undefined,
  closingHash: undefined,
})

describe("buildSummary", () => {
  it("returns undefined when the workflow declares no summary: template, regardless of run/base", () => {
    const run = trace([
      { state: "unwind", hash: "h1", actor: "agent" },
      { state: "idle", hash: "h2", actor: "human" },
    ])
    expect(buildSummary(def(undefined), run, baseContext())).toBeUndefined()
  })

  it("returns undefined when run.trace is empty, even with a summary: template set", () => {
    const run = trace([])
    expect(
      buildSummary(def("Summary of <%= it.entryCommit %>"), run, baseContext()),
    ).toBeUndefined()
  })

  it("derives entryCommit/humanCommits/processTip from the trace and renders them into the template", () => {
    const run = trace([
      { state: "unwind", hash: "h1", actor: "agent" },
      { state: "design.gate.answer", hash: "h2", actor: "human" },
      { state: "architecture.author", hash: "h3", actor: "agent" },
      { state: "architecture.gate.answer", hash: "h4", actor: "human" },
      { state: "idle", hash: "h5", actor: "agent" },
    ])
    const template = [
      "entry=<%= it.entryCommit %>",
      "tip=<%= it.processTip %>",
      "humans=<% it.humanCommits.forEach(function(h){ %><%= h.hash %>:<%= h.state %>;<% }) %>",
    ].join(" ")
    const out = buildSummary(def(template), run, baseContext())
    expect(out).toBe("entry=h1 tip=h5 humans=h2:design.gate.answer;h4:architecture.gate.answer;")
  })

  it("dedupes the entry commit out of humanCommits even when the entry commit was itself human-authored", () => {
    const run = trace([
      { state: "unwind", hash: "h1", actor: "human" },
      { state: "design.gate.answer", hash: "h2", actor: "human" },
      { state: "idle", hash: "h3", actor: "agent" },
    ])
    const template = [
      "entry=<%= it.entryCommit %>",
      "humans=<% it.humanCommits.forEach(function(h){ %><%= h.hash %>;<% }) %>",
    ].join(" ")
    const out = buildSummary(def(template), run, baseContext())
    expect(out).toBe("entry=h1 humans=h2;")
  })

  it("humanCommits is empty when the entry commit is agent-authored and no other trace entry is human", () => {
    const run = trace([
      { state: "unwind", hash: "h1", actor: "agent" },
      { state: "architecture.author", hash: "h2", actor: "agent" },
      { state: "idle", hash: "h3", actor: "agent" },
    ])
    const template = "count=<%= it.humanCommits.length %>"
    const out = buildSummary(def(template), run, baseContext())
    expect(out).toBe("count=0")
  })

  it("a judge-authored commit names no entry in humanCommits — a judge's verdict is not a human contribution to summarize (package 02)", () => {
    const run = trace([
      { state: "unwind", hash: "h1", actor: "agent" },
      { state: "build.health.judge", hash: "h2", actor: "judge" },
      { state: "design.gate.answer", hash: "h3", actor: "human" },
      { state: "idle", hash: "h4", actor: "agent" },
    ])
    const template =
      "humans=<% it.humanCommits.forEach(function(h){ %><%= h.hash %>:<%= h.state %>;<% }) %>"
    const out = buildSummary(def(template), run, baseContext())
    expect(out).toBe("humans=h3:design.gate.answer;")
  })

  it("passes base's processCost/processCostByModel through into the rendered output", () => {
    const run = trace([{ state: "idle", hash: "h1", actor: "agent" }])
    const template = [
      "cost=<%= it.processCost %>",
      "<% it.processCostByModel.forEach(function(m){ %><%= m.model %>=<%= m.cost %>;<% }) %>",
    ].join(" ")
    const out = buildSummary(
      def(template),
      run,
      baseContext({
        processCost: 4200,
        processCostByModel: [
          { model: "opus", cost: 3000 },
          { model: "haiku", cost: 1200 },
        ],
      }),
    )
    expect(out).toBe("cost=4200 opus=3000;haiku=1200;")
  })

  it("is a pure function of its arguments — no read()/git call happens for a template that never references them", () => {
    const run = trace([{ state: "idle", hash: "h1", actor: "agent" }])
    const context = baseContext({
      read: () => {
        throw new Error("read() must not be called unless the template references it.read")
      },
    })
    expect(buildSummary(def("static summary, no interpolation"), run, context)).toBe(
      "static summary, no interpolation",
    )
  })
})
