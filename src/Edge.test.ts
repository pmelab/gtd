import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import { strictGitOperations as stubGit } from "./testing/GitDoubles.js"
import {
  computeProcessRun,
  executeDecision,
  memoryKeyFor,
  pendingChanges,
  renderFile,
  renderLabel,
  renderModel,
  renderOnEdges,
  resolveVars,
  retainsNothing,
  costByModel,
  parseCostTrailers,
  totalCostOf,
  toTemplateEdges,
  UNATTRIBUTED_MODEL,
  withCostTrailer,
  withRenderedOn,
  parseReviewBaseTrailer,
  withEntryTrailers,
  parseEntryVarTrailers,
  type ProcessRun,
  type ResolvedRest,
  type TraceEntry,
} from "./Edge.js"
import { withHistoryTrailer, parseHistoryTrailer } from "./RetainedHistory.js"
import type { TemplateContext } from "./PatternTemplates.js"
import type { StateDef, WorkflowDefinition } from "./PatternMachine.js"

/**
 * Unit coverage for the surviving edge logic that doesn't need a real (or
 * in-memory) repo to exercise meaningfully: `computeProcessRun`'s
 * boundary-walk, `pendingChanges`' status normalization, and
 * `executeDecision`'s commit/squash IO sequencing (including the "a failed
 * commit-template render touches nothing" guarantee). Full behavioral
 * coverage against a real resolved rest lives in the e2e feature files.
 */

const run = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

/**
 * A minimal definition for `computeProcessRun`'s tests: only `idle` being
 * `entries.default` matters to the boundary walk (`initialStateOf` never
 * looks up any OTHER state named in test history, e.g. "grilling"/"building"
 * below — the walk only compares parsed state names against the initial
 * state's NAME as a string).
 */
const def: WorkflowDefinition = {
  states: { idle: { actor: "human", message: "m" } },
  entries: { default: "idle", manual: [] },
}

describe("computeProcessRun", () => {
  it("an empty repo has an empty run, the empty-tree sentinel as start parent", async () => {
    const git = stubGit({ hasCommits: () => Effect.succeed(false) })
    const result = await run(computeProcessRun(git, def))
    expect(result).toEqual({
      startHash: "",
      startParentHash: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      diffBase: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      trace: [],
      costEntries: [],
      entryVars: {},
    })
  })

  it("walks back to the nearest non-workflow boundary commit, collecting the workflow run's trace (a) — [boundary, gtd(human): grilling, gtd(agent): building]", async () => {
    const history = [
      { hash: "h0", message: "chore: init", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(human): grilling", removedErrors: false, touched: [] },
      { hash: "h2", message: "gtd(agent): building", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result).toEqual({
      startHash: "h1",
      startParentHash: "h0",
      diffBase: "h0",
      trace: [
        { state: "grilling", hash: "h1" },
        { state: "building", hash: "h2" },
      ],
      costEntries: [],
      entryVars: {},
    })
  })

  it("a run covering the whole history (root commit is itself a workflow commit) uses the empty-tree sentinel", async () => {
    const history = [
      { hash: "h0", message: "gtd(agent): grilling", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.startParentHash).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904")
    expect(result.trace).toEqual([{ state: "grilling", hash: "h0" }])
  })

  it("no workflow commit at HEAD (a fresh non-workflow boundary) is an empty run whose start is HEAD itself", async () => {
    const history = [{ hash: "h0", message: "chore: squashed", removedErrors: false, touched: [] }]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result).toEqual({
      startHash: "h0",
      startParentHash: "h0",
      diffBase: "h0",
      trace: [],
      costEntries: [],
      entryVars: {},
    })
  })

  it("(b) a commit entering the initial state mid-history is ALSO a process boundary, excluded from the newer process's trace — [boundary, …cycle1…, gtd(human): idle, gtd(human): grilling, gtd(agent): building]", async () => {
    const history = [
      { hash: "h0", message: "chore: init", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(agent): building", removedErrors: false, touched: [] }, // cycle 1
      { hash: "h2", message: "gtd(human): idle", removedErrors: false, touched: [] }, // boundary: approval rests at idle
      { hash: "h3", message: "gtd(human): grilling", removedErrors: false, touched: [] }, // cycle 2
      { hash: "h4", message: "gtd(agent): building", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result).toEqual({
      startHash: "h3",
      startParentHash: "h2",
      diffBase: "h2",
      trace: [
        { state: "grilling", hash: "h3" },
        { state: "building", hash: "h4" },
      ],
      costEntries: [],
      entryVars: {},
    })
  })

  it("(c) HEAD itself entering the initial state yields an EMPTY process — fresh rest, trace []", async () => {
    const history = [
      { hash: "h0", message: "chore: init", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(agent): building", removedErrors: false, touched: [] },
      { hash: "h2", message: "gtd(human): idle", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result).toEqual({
      startHash: "h2",
      startParentHash: "h2",
      diffBase: "h2",
      trace: [],
      costEntries: [],
      entryVars: {},
    })
  })

  it("(d) retry counting resets across an idle boundary — a state entered 3x before the idle entry counts 0 after", async () => {
    const history = [
      { hash: "h0", message: "chore: init", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(agent): fixing", removedErrors: false, touched: [] },
      { hash: "h2", message: "gtd(agent): fixing", removedErrors: false, touched: [] },
      { hash: "h3", message: "gtd(agent): fixing", removedErrors: false, touched: [] },
      { hash: "h4", message: "gtd(human): idle", removedErrors: false, touched: [] }, // boundary
      { hash: "h5", message: "gtd(human): grilling", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.startParentHash).toBe("h4")
    expect(result.trace).toEqual([{ state: "grilling", hash: "h5" }])
    expect(result.trace.filter((entry) => entry.state === "fixing")).toHaveLength(0)
  })

  it("collects the process's turn-commit `Gtd-Cost:` entries (with models), ignoring the boundary's", async () => {
    const history = [
      // Boundary commit's trailer is EXCLUDED from the current process's entries.
      {
        hash: "h0",
        message: "chore: init\n\nGtd-Cost: 999 opus",
        removedErrors: false,
        touched: [],
      },
      {
        hash: "h1",
        message: "gtd(human): grilling\n\nGtd-Cost: 120 opus",
        removedErrors: false,
        touched: [],
      },
      {
        hash: "h2",
        message: "gtd(agent): building\n\nGtd-Cost: 300 haiku",
        removedErrors: false,
        touched: [],
      },
      // A turn with a model-less trailer buckets under UNATTRIBUTED_MODEL.
      {
        hash: "h3",
        message: "gtd(agent): checking\n\nGtd-Cost: 50",
        removedErrors: false,
        touched: [],
      },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.trace).toEqual([
      { state: "grilling", hash: "h1" },
      { state: "building", hash: "h2" },
      { state: "checking", hash: "h3" },
    ])
    expect(result.costEntries).toEqual([
      { cost: 120, model: "opus" },
      { cost: 300, model: "haiku" },
      { cost: 50, model: UNATTRIBUTED_MODEL },
    ])
  })

  it("a `Gtd-Review-Base:` trailer on the process's OLDEST commit overrides `diffBase`, leaving the trace/retry boundary (`startParentHash`) untouched — the `gtd review <commitish>` entry commit", async () => {
    const history = [
      // A plain, non-workflow commit — e.g. a colleague's PR branch commit —
      // is the trace boundary (excluded, like any other boundary commit).
      { hash: "h0", message: "feat: add calculator", removedErrors: false, touched: [] },
      {
        hash: "h1",
        message: "gtd(human): reviewing\n\nGtd-Review-Base: deadbeef",
        removedErrors: false,
        touched: [],
      },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.trace).toEqual([{ state: "reviewing", hash: "h1" }])
    expect(result.startParentHash).toBe("h0")
    expect(result.diffBase).toBe("deadbeef")
  })

  it("a `Gtd-Review-Base:` trailer on a LATER turn (not the process's oldest commit) is never consulted for the override", async () => {
    const history = [
      { hash: "h0", message: "feat: add calculator", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(human): reviewing", removedErrors: false, touched: [] },
      // A later turn happens to carry a trailer that LOOKS like the review-base
      // one — never mistaken for the process's own entry commit.
      {
        hash: "h2",
        message: "gtd(human): await-review\n\nGtd-Review-Base: not-the-real-base",
        removedErrors: false,
        touched: [],
      },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.diffBase).toBe(result.startParentHash)
    expect(result.diffBase).toBe("h0")
  })

  it("collects `Gtd-Var:` entries off the process's OLDEST commit into `entryVars`", async () => {
    const history = [
      { hash: "h0", message: "feat: add calculator", removedErrors: false, touched: [] },
      {
        hash: "h1",
        message: "gtd(human): reviewing\n\nGtd-Var: base=refs/heads/main\nGtd-Var: reviewer=alice",
        removedErrors: false,
        touched: [],
      },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.entryVars).toEqual({ base: "refs/heads/main", reviewer: "alice" })
  })

  it("a `Gtd-Var:` trailer on a LATER turn (not the process's oldest commit) never shows up in `entryVars`", async () => {
    const history = [
      { hash: "h0", message: "feat: add calculator", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(human): reviewing", removedErrors: false, touched: [] },
      // A later turn happens to carry a trailer that LOOKS like the entry-var
      // one — never mistaken for the process's own entry commit.
      {
        hash: "h2",
        message: "gtd(human): await-review\n\nGtd-Var: sneaky=not-the-real-entry",
        removedErrors: false,
        touched: [],
      },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.entryVars).toEqual({})
  })

  it("with no `Gtd-Var:` trailer, `entryVars` defaults to `{}`", async () => {
    const history = [
      { hash: "h0", message: "chore: init", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(human): grilling", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.entryVars).toEqual({})
  })

  it("with no `Gtd-Review-Base:` trailer, `diffBase` defaults to `startParentHash` (the ordinary case)", async () => {
    const history = [
      { hash: "h0", message: "chore: init", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(human): grilling", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.diffBase).toBe(result.startParentHash)
  })

  it("keeps each trace entry's commit hash alongside its state name", async () => {
    const history = [
      { hash: "h0", message: "chore: init", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(human): grilling", removedErrors: false, touched: [] },
      { hash: "h2", message: "gtd(agent): building", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result.trace).toEqual([
      { state: "grilling", hash: "h1" },
      { state: "building", hash: "h2" },
    ])
  })
})

const promptRest = (state: string, workflowDef: WorkflowDefinition): ResolvedRest => ({
  def: workflowDef,
  state,
  stateDef: { actor: "agent", prompt: "think" },
  actor: "agent",
})

const runWith = (startParentHash: string, trace: readonly TraceEntry[]): ProcessRun => ({
  startHash: trace[0]?.hash ?? startParentHash,
  startParentHash,
  diffBase: startParentHash,
  trace,
  costEntries: [],
  entryVars: {},
})

describe("memoryKeyFor", () => {
  const scopes: Readonly<Record<string, string>> = {
    "job.think": "job",
    "job.done": "job",
    "other.state": "other",
  }

  it("returns undefined for a non-prompt rest, regardless of scopes/run", async () => {
    const rest: ResolvedRest = {
      def,
      state: "job.think",
      stateDef: { actor: "check", script: "npm test" },
      actor: "check",
    }
    const run = runWith("start-parent", [])
    expect(memoryKeyFor(scopes, rest, run)).toBeUndefined()
  })

  it("anchors to `startParentHash` at trace position 0 (the entry sits at the very start of the trace)", () => {
    const rest = promptRest("job.think", def)
    // The trace already contains ONE prior entry into this same scope, at
    // index 0 — `entryIndex` resolves to 0, not -1, but the token is still
    // `startParentHash` (no earlier trace entry exists to anchor to).
    const run = runWith("start-parent", [{ state: "job.think", hash: "h1" }])
    expect(memoryKeyFor(scopes, rest, run)).toBe(`job#${"start-parent".slice(0, 7)}`)
  })

  it("anchors to `startParentHash` for an empty trace too — position 0 and the empty trace coincide by construction", () => {
    const rest = promptRest("job.think", def)
    const run = runWith("start-parent", [])
    expect(memoryKeyFor(scopes, rest, run)).toBe(`job#${"start-parent".slice(0, 7)}`)
  })

  it("anchors to the commit immediately BEFORE a later unbroken scope entry began", () => {
    const rest = promptRest("job.done", def)
    // The current unbroken run into the `job` scope started at trace index 1
    // (`job.think`, right after the unrelated `other.state` turn) —
    // `entryIndex` resolves to 1, so the token is `trace[0].hash`, the commit
    // the run started FROM, not the run's own first commit.
    const run = runWith("start-parent", [
      { state: "other.state", hash: "h0" },
      { state: "job.think", hash: "h1" },
    ])
    expect(memoryKeyFor(scopes, rest, run)).toBe(`job#${"h0".slice(0, 7)}`)
  })

  it("formats the key as `${scope}#${first 7 chars of the token hash}`", () => {
    const rest = promptRest("job.think", def)
    const run = runWith("abcdefabcdefabcdef", [])
    expect(memoryKeyFor(scopes, rest, run)).toBe("job#abcdefa")
  })

  it("returns undefined when `memoryScopeAt` itself can't resolve a scope (the rest's state is absent from `scopes`)", () => {
    const rest = promptRest("no-such-state", def)
    const run = runWith("start-parent", [])
    expect(memoryKeyFor(scopes, rest, run)).toBeUndefined()
  })
})

describe("pendingChanges", () => {
  it("passes A/D through and collapses everything else (renames, type changes, ...) to M", async () => {
    const git = stubGit({
      changedPaths: () =>
        Effect.succeed([
          { path: "new.ts", status: "A" },
          { path: "gone.ts", status: "D" },
          { path: "edited.ts", status: "M" },
          { path: "renamed.ts", status: "R100" },
        ]),
    })
    const result = await run(pendingChanges(git))
    expect(result).toEqual([
      { status: "A", path: "new.ts" },
      { status: "D", path: "gone.ts" },
      { status: "M", path: "edited.ts" },
      { status: "M", path: "renamed.ts" },
    ])
  })
})

describe("retainsNothing", () => {
  const run = {
    startHash: "s",
    startParentHash: "p",
    diffBase: "p",
    trace: [],
    costEntries: [],
    entryVars: {},
  }

  it("true on a clean tree with no range changes since the trace/retry boundary", async () => {
    const git = stubGit({ changedPathsSince: () => Effect.succeed([]) })
    expect(await Effect.runPromise(retainsNothing(git, run, []))).toBe(true)
  })

  it("false when there are pending changes, even with no committed range changes", async () => {
    const git = stubGit({ changedPathsSince: () => Effect.succeed([]) })
    expect(await Effect.runPromise(retainsNothing(git, run, [{ status: "M", path: "x.ts" }]))).toBe(
      false,
    )
  })

  it("false when the range has changed paths, even on a clean tree", async () => {
    const git = stubGit({
      changedPathsSince: () => Effect.succeed([{ path: "x.ts", status: "M" }]),
    })
    expect(await Effect.runPromise(retainsNothing(git, run, []))).toBe(false)
  })
})

const context = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  startCommit: "start",
  currentCommit: "current",
  previousCommit: "previous",
  state: "squashing",
  actor: "agent",
  reviewBase: "",
  retainedBase: "",
  processCost: 0,
  processCostByModel: [],
  read: () => {
    throw new Error("no file registered")
  },
  vars: {},
  edges: [],
  ...overrides,
})

describe("executeDecision", () => {
  it("a commit decision commits everything pending under the decided subject", async () => {
    const commitAllWithPrefix = vi.fn(() => Effect.succeed(undefined))
    const git = stubGit({ commitAllWithPrefix })
    const outcome = await run(
      executeDecision(
        git,
        {
          startHash: "s",
          startParentHash: "p",
          diffBase: "p",
          trace: [{ state: "grilling", hash: "h" }],
          costEntries: [],
          entryVars: {},
        },
        {
          kind: "commit",
          subject: "gtd(human): grilling-answer",
          actor: "human",
          from: "grilling",
          to: "grilling-answer",
        },
        context(),
      ),
    )
    expect(outcome).toEqual({ kind: "commit", subject: "gtd(human): grilling-answer" })
    expect(commitAllWithPrefix).toHaveBeenCalledWith("gtd(human): grilling-answer")
  })

  it("a commit decision with a cost appends a `Gtd-Cost:` trailer (subject line untouched)", async () => {
    const commitAllWithPrefix = vi.fn(() => Effect.succeed(undefined))
    const git = stubGit({ commitAllWithPrefix })
    const outcome = await run(
      executeDecision(
        git,
        {
          startHash: "s",
          startParentHash: "p",
          diffBase: "p",
          trace: [{ state: "grilling", hash: "h" }],
          costEntries: [],
          entryVars: {},
        },
        {
          kind: "commit",
          subject: "gtd(agent): building",
          actor: "agent",
          from: "grilling-answer",
          to: "building",
        },
        context(),
        1234,
        "claude-opus-4-8",
      ),
    )
    // The reported subject is still the bare subject line...
    expect(outcome).toEqual({ kind: "commit", subject: "gtd(agent): building" })
    // ...while the committed message carries the cost + model trailer after a blank line.
    expect(commitAllWithPrefix).toHaveBeenCalledWith(
      "gtd(agent): building\n\nGtd-Cost: 1234 claude-opus-4-8",
    )
  })

  it("a squash decision renders, soft-resets, commits as-is, and discards the rest", async () => {
    const calls: string[] = []
    const resolveRef = vi.fn(() => {
      calls.push("resolveRef")
      return Effect.succeed("tip-hash")
    })
    const updateRef = vi.fn(() => {
      calls.push("updateRef")
      return Effect.succeed(undefined)
    })
    const softResetTo = vi.fn(() => {
      calls.push("softResetTo")
      return Effect.succeed(undefined)
    })
    const commitAsIs = vi.fn(() => {
      calls.push("commitAsIs")
      return Effect.succeed(undefined)
    })
    const discardPending = vi.fn(() => {
      calls.push("discardPending")
      return Effect.succeed(undefined)
    })
    const git = stubGit({ resolveRef, updateRef, softResetTo, commitAsIs, discardPending })
    const outcome = await run(
      executeDecision(
        git,
        {
          startHash: "s",
          startParentHash: "parent-hash",
          diffBase: "parent-hash",
          trace: [{ state: "squashing", hash: "h" }],
          costEntries: [],
          entryVars: {},
        },
        { kind: "squash", state: "done", template: "feat: <%= it.state %>" },
        context({ state: "done" }),
      ),
    )
    expect(outcome).toEqual({ kind: "squash", subject: "feat: done" })
    expect(softResetTo).toHaveBeenCalledWith("parent-hash")
    expect(commitAsIs).toHaveBeenCalledWith("feat: done\n\nGtd-History: tip-hash")
    expect(discardPending).toHaveBeenCalledOnce()
    // The retention write (via `updateRef`) happens before the soft reset rewrites HEAD.
    expect(calls.indexOf("updateRef")).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf("updateRef")).toBeLessThan(calls.indexOf("softResetTo"))
  })

  it("a failed commit-template render refuses the step, touching nothing", async () => {
    const git = stubGit({}) // every git method fails if called
    const decision = await run(
      executeDecision(
        git,
        {
          startHash: "s",
          startParentHash: "parent-hash",
          diffBase: "parent-hash",
          trace: [],
          costEntries: [],
          entryVars: {},
        },
        { kind: "squash", state: "done", template: '<%~ it.read("missing.md") %>' },
        context(),
      ),
    ).then(
      () => "resolved" as const,
      (e: Error) => e,
    )
    expect(decision).not.toBe("resolved")
    expect((decision as Error).message).toContain('rendering the "done" commit template failed')
  })

  it("a no-op decision performs no IO", async () => {
    const git = stubGit({})
    const outcome = await run(
      executeDecision(
        git,
        {
          startHash: "s",
          startParentHash: "p",
          diffBase: "p",
          trace: [],
          costEntries: [],
          entryVars: {},
        },
        { kind: "noop", state: "idle" },
        context(),
      ),
    )
    expect(outcome).toEqual({ kind: "noop", state: "idle" })
  })
})

describe("withCostTrailer", () => {
  it("returns the subject unchanged when no cost is supplied", () => {
    expect(withCostTrailer("gtd(agent): building", undefined, undefined)).toBe(
      "gtd(agent): building",
    )
  })

  it("appends a `Gtd-Cost:` trailer after a blank line, leaving the subject as the first line", () => {
    const message = withCostTrailer("gtd(agent): building", 42, undefined)
    expect(message).toBe("gtd(agent): building\n\nGtd-Cost: 42")
    expect(message.split("\n")[0]).toBe("gtd(agent): building")
  })

  it("appends the model after the cost when one is supplied", () => {
    expect(withCostTrailer("gtd(agent): building", 42, "claude-opus-4-8")).toBe(
      "gtd(agent): building\n\nGtd-Cost: 42 claude-opus-4-8",
    )
  })

  it("records a zero cost verbatim (an explicit 0 is not the same as absent)", () => {
    expect(withCostTrailer("gtd(check): checking", 0, undefined)).toBe(
      "gtd(check): checking\n\nGtd-Cost: 0",
    )
  })
})

describe("parseCostTrailers", () => {
  it("parses cost + model, defaulting a model-less entry to UNATTRIBUTED_MODEL", () => {
    expect(
      parseCostTrailers([
        "gtd(human): grilling\n\nGtd-Cost: 120 opus",
        "gtd(agent): building\n\nGtd-Cost: 300", // no model
        "gtd(agent): checking", // no trailer at all
      ]),
    ).toEqual([
      { cost: 120, model: "opus" },
      { cost: 300, model: UNATTRIBUTED_MODEL },
    ])
  })

  it("accepts decimal costs", () => {
    expect(parseCostTrailers(["x\n\nGtd-Cost: 1.5 opus"])).toEqual([{ cost: 1.5, model: "opus" }])
  })

  it("ignores a `Gtd-Cost:`-looking line whose value is not a bare number", () => {
    expect(parseCostTrailers(["x\n\nGtd-Cost: not-a-number", "y\n\nGtd-Cost: 10"])).toEqual([
      { cost: 10, model: UNATTRIBUTED_MODEL },
    ])
  })
})

describe("parseReviewBaseTrailer", () => {
  it("reads the hash back off a message carrying the trailer", () => {
    expect(parseReviewBaseTrailer("gtd(human): reviewing\n\nGtd-Review-Base: abc123")).toBe(
      "abc123",
    )
  })

  it("is undefined when the message carries no such trailer", () => {
    expect(parseReviewBaseTrailer("gtd(human): reviewing")).toBeUndefined()
    expect(parseReviewBaseTrailer("chore: init\n\nGtd-Cost: 10")).toBeUndefined()
  })
})

describe("withEntryTrailers / parseEntryVarTrailers", () => {
  it("neither base nor vars leaves the subject unchanged, no trailing blank line", () => {
    const message = withEntryTrailers("gtd(human): reviewing", { vars: {} })
    expect(message).toBe("gtd(human): reviewing")
  })

  it("base only appends a `Gtd-Review-Base:` trailer after a blank line, leaving the subject as the first line", () => {
    const message = withEntryTrailers("gtd(human): reviewing", { base: "abc123", vars: {} })
    expect(message).toBe("gtd(human): reviewing\n\nGtd-Review-Base: abc123")
    expect(message.split("\n")[0]).toBe("gtd(human): reviewing")
    expect(parseReviewBaseTrailer(message)).toBe("abc123")
  })

  it("vars only appends one `Gtd-Var:` line per entry, in `Object.entries` order", () => {
    const message = withEntryTrailers("gtd(human): reviewing", {
      vars: { reviewer: "alice", base: "refs/heads/main" },
    })
    expect(message).toBe(
      "gtd(human): reviewing\n\nGtd-Var: reviewer=alice\nGtd-Var: base=refs/heads/main",
    )
    expect(parseEntryVarTrailers(message)).toEqual({
      reviewer: "alice",
      base: "refs/heads/main",
    })
  })

  it("base + vars together: the review-base line comes first, then the var lines", () => {
    const message = withEntryTrailers("gtd(human): reviewing", {
      base: "deadbeef",
      vars: { reviewer: "alice" },
    })
    expect(message).toBe(
      "gtd(human): reviewing\n\nGtd-Review-Base: deadbeef\nGtd-Var: reviewer=alice",
    )
    expect(parseReviewBaseTrailer(message)).toBe("deadbeef")
    expect(parseEntryVarTrailers(message)).toEqual({ reviewer: "alice" })
  })

  it("a var value containing `=` round-trips (split on the FIRST `=` only)", () => {
    const message = withEntryTrailers("gtd(human): reviewing", {
      vars: { base: "refs/heads/a=b" },
    })
    expect(message).toBe("gtd(human): reviewing\n\nGtd-Var: base=refs/heads/a=b")
    expect(parseEntryVarTrailers(message)).toEqual({ base: "refs/heads/a=b" })
  })

  it("parseEntryVarTrailers returns {} when the message carries no such lines", () => {
    expect(parseEntryVarTrailers("gtd(human): reviewing")).toEqual({})
    expect(parseEntryVarTrailers("chore: init\n\nGtd-Cost: 10")).toEqual({})
  })
})

describe("withHistoryTrailer", () => {
  it("appends a `Gtd-History:` trailer after a blank line, leaving the subject as the first line", () => {
    const message = withHistoryTrailer("subject line", "abc123")
    expect(message).toBe("subject line\n\nGtd-History: abc123")
    expect(message.split("\n")[0]).toBe("subject line")
  })
})

describe("parseHistoryTrailer", () => {
  it("reads the hash back off a message carrying the trailer", () => {
    expect(parseHistoryTrailer("subject line\n\nGtd-History: abc123")).toBe("abc123")
  })

  it("is undefined when the message carries no such trailer", () => {
    expect(parseHistoryTrailer("subject line")).toBeUndefined()
    expect(parseHistoryTrailer("chore: init\n\nGtd-Cost: 10")).toBeUndefined()
  })
})

describe("totalCostOf / costByModel", () => {
  const entries = [
    { cost: 120, model: "opus" },
    { cost: 300, model: "haiku" },
    { cost: 80, model: "opus" },
    { cost: 50, model: UNATTRIBUTED_MODEL },
  ]

  it("totalCostOf sums every entry (0 over an empty list)", () => {
    expect(totalCostOf(entries)).toBe(550)
    expect(totalCostOf([])).toBe(0)
  })

  it("costByModel groups by model, highest-cost first", () => {
    expect(costByModel(entries)).toEqual([
      { model: "haiku", cost: 300 },
      { model: "opus", cost: 200 },
      { model: UNATTRIBUTED_MODEL, cost: 50 },
    ])
  })
})

describe("resolveVars — the four-layer `it.vars` merge (workflow < rc < entryVars < env)", () => {
  it("with only a workflow default, that default wins", () => {
    expect(resolveVars({ testCommand: "npm test" }, {}, {}, {})).toEqual({
      testCommand: "npm test",
    })
  })

  it("a `.gtdrc` `vars:` entry overrides the workflow's own default for the same name", () => {
    expect(
      resolveVars(
        { testCommand: "npm test", reviewer: "alice" },
        { testCommand: "npm run check" },
        {},
        {},
      ),
    ).toEqual({ testCommand: "npm run check", reviewer: "alice" })
  })

  it("a `GTD_<UPPERCASE>` environment variable beats both the workflow default and the rc value", () => {
    expect(
      resolveVars(
        { testCommand: "npm test" },
        { testCommand: "npm run check" },
        {},
        { GTD_TESTCOMMAND: "echo env-wins" },
      ),
    ).toEqual({ testCommand: "echo env-wins" })
  })

  it("ignores a `GTD_*` env var whose uppercased name matches no declared var", () => {
    expect(resolveVars({}, {}, {}, { GTD_BRANDNEW: "hello" })).toEqual({})
  })

  it("matches only the fully-uppercased name — `GTD_TestCommand` (not all-caps) does not override", () => {
    expect(
      resolveVars({ testCommand: "npm test" }, {}, {}, { GTD_TestCommand: "not-uppercase" }),
    ).toEqual({ testCommand: "npm test" })
  })

  it("ignores env entries matching no declared var (e.g. the loop driver's own GTD_LOOP_LOG), and skips an unset (`undefined`-valued) entry for a declared var", () => {
    expect(
      resolveVars(
        { kept: "default", unset: "default" },
        {},
        {},
        { PATH: "/usr/bin", GTD_KEPT: "yes", GTD_LOOP_LOG: "/tmp/log", GTD_UNSET: undefined },
      ),
    ).toEqual({ kept: "yes", unset: "default" })
  })

  it("entryVars overrides both the workflow default and the rc value for the same name", () => {
    expect(
      resolveVars(
        { testCommand: "npm test", reviewer: "alice" },
        { testCommand: "npm run check" },
        { testCommand: "npm run entry-check" },
        {},
      ),
    ).toEqual({ testCommand: "npm run entry-check", reviewer: "alice" })
  })

  it("entryVars introduces a name declared by neither workflow nor rc (a plain unconditional spread)", () => {
    expect(resolveVars({}, {}, { base: "refs/heads/main" }, {})).toEqual({
      base: "refs/heads/main",
    })
  })

  it("env still beats entryVars — the topmost layer wins", () => {
    expect(
      resolveVars(
        { testCommand: "npm test" },
        {},
        { testCommand: "npm run entry-check" },
        { GTD_TESTCOMMAND: "echo env-wins" },
      ),
    ).toEqual({ testCommand: "echo env-wins" })
  })
})

describe("toTemplateEdges — OnEdge tuples to the `{ pattern, target, describe? }` templates see", () => {
  it("maps a two-element edge with no describe key, and a three-element edge with one", () => {
    expect(
      toTemplateEdges([
        ["C", "building", "Change nothing to accept and build."],
        ["* **", "grilling"],
      ]),
    ).toEqual([
      { pattern: "C", target: "building", describe: "Change nothing to accept and build." },
      { pattern: "* **", target: "grilling" },
    ])
  })

  it("returns an empty list for a state with no `on` (a commit state)", () => {
    expect(toTemplateEdges(undefined)).toEqual([])
  })

  it("omits the describe key entirely (never `undefined`) when an edge carries none", () => {
    const [edge] = toTemplateEdges([["* **", "next"]])
    expect("describe" in edge!).toBe(false)
  })

  it("carries `action` alongside `describe` when both are present", () => {
    expect(toTemplateEdges([["C", "building", "Change nothing.", "Accept plan"]])).toEqual([
      { pattern: "C", target: "building", describe: "Change nothing.", action: "Accept plan" },
    ])
  })

  it("carries `action` with no `describe` (the placeholder-in-slot-3 case)", () => {
    expect(toTemplateEdges([["C", "building", undefined, "Accept plan"]])).toEqual([
      { pattern: "C", target: "building", action: "Accept plan" },
    ])
  })

  it("omits both describe and action keys entirely when neither is present", () => {
    const [edge] = toTemplateEdges([["C", "building"]])
    expect("describe" in edge!).toBe(false)
    expect("action" in edge!).toBe(false)
  })

  it("omits the action key entirely (never `undefined`) when an edge carries none, even with a describe", () => {
    const [edge] = toTemplateEdges([["C", "building", "Change nothing."]])
    expect("action" in edge!).toBe(false)
  })
})

describe("renderOnEdges — `on` pattern keys rendered against `it.vars`", () => {
  it("renders each pattern's Eta tags against the given vars, preserving target/order", () => {
    const rendered = renderOnEdges(
      [
        ["A <%= it.vars.feedbackFile %>", "fixing"],
        ["C", "building"],
      ],
      { feedbackFile: ".gtd/FEEDBACK.md" },
    )
    expect(rendered).toEqual([
      ["A .gtd/FEEDBACK.md", "fixing"],
      ["C", "building"],
    ])
  })

  it("preserves an edge's `describe`", () => {
    const rendered = renderOnEdges(
      [["A <%= it.vars.feedbackFile %>", "fixing", "Feedback was left."]],
      { feedbackFile: ".gtd/FEEDBACK.md" },
    )
    expect(rendered).toEqual([["A .gtd/FEEDBACK.md", "fixing", "Feedback was left."]])
  })

  it("preserves an edge's `action` alongside `describe`, never rendering it", () => {
    const rendered = renderOnEdges(
      [["A <%= it.vars.feedbackFile %>", "fixing", "Feedback was left.", "Accept plan"]],
      { feedbackFile: ".gtd/FEEDBACK.md" },
    )
    expect(rendered).toEqual([
      ["A .gtd/FEEDBACK.md", "fixing", "Feedback was left.", "Accept plan"],
    ])
  })

  it("preserves an edge's `action` with no `describe` (the placeholder-in-slot-3 case)", () => {
    const rendered = renderOnEdges(
      [["A <%= it.vars.feedbackFile %>", "fixing", undefined, "Accept plan"]],
      { feedbackFile: ".gtd/FEEDBACK.md" },
    )
    expect(rendered).toEqual([["A .gtd/FEEDBACK.md", "fixing", undefined, "Accept plan"]])
  })

  it("returns an empty list for `undefined` (a commit state's `on`)", () => {
    expect(renderOnEdges(undefined, {})).toEqual([])
  })

  it("a default var renders byte-identical to a literal path — no behavior change at default vars", () => {
    const rendered = renderOnEdges([["A <%= it.vars.feedbackFile %>", "fixing"]], {
      feedbackFile: ".gtd/FEEDBACK.md",
    })
    expect(rendered).toEqual([["A .gtd/FEEDBACK.md", "fixing"]])
  })

  it("throws whatever Eta throws for a malformed pattern template", () => {
    expect(() => renderOnEdges([["A <%= it.vars.nope.deeper %>", "fixing"]], {})).toThrow()
  })
})

describe("withRenderedOn — patches only the resting state's `on` for `step`", () => {
  const def: WorkflowDefinition = {
    states: {
      idle: { actor: "human", message: "m", on: [["A <%= it.vars.x %>", "idle"]] },
      other: { actor: "human", message: "m", on: [["A <%= it.vars.y %>", "other"]] },
    },
    entries: { default: "idle", manual: [] },
  }

  it("replaces the named state's `on` with the given rendered edges", () => {
    const patched = withRenderedOn(def, "idle", [["A rendered", "idle"]])
    expect(patched.states.idle!.on).toEqual([["A rendered", "idle"]])
  })

  it("leaves every other state's `on` untouched", () => {
    const patched = withRenderedOn(def, "idle", [["A rendered", "idle"]])
    expect(patched.states.other!.on).toEqual([["A <%= it.vars.y %>", "other"]])
  })

  it("leaves the rest of the definition (states map keys, modes, etc) untouched", () => {
    const patched = withRenderedOn(def, "idle", [])
    expect(Object.keys(patched.states)).toEqual(["idle", "other"])
  })
})

describe("renderModel", () => {
  const stateDef = (model?: string): StateDef =>
    model !== undefined ? { actor: "agent", prompt: "x", model } : { actor: "agent", prompt: "x" }

  const run1 = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

  it("a state with no `model:` renders to `undefined`", async () => {
    const result = await run1(renderModel(stateDef(), context()))
    expect(result).toBeUndefined()
  })

  it("a plain string with no Eta tags passes through unchanged", async () => {
    const result = await run1(renderModel(stateDef("smart"), context()))
    expect(result).toBe("smart")
  })

  it("a templated `model:` resolves against the same `it.vars` the content sees", async () => {
    const result = await run1(
      renderModel(
        stateDef("<%= it.vars.reviewModel %>"),
        context({ vars: { reviewModel: "opus" } }),
      ),
    )
    expect(result).toBe("opus")
  })

  it("a model render failure propagates as a thrown/rejected error, same as a content render failure", async () => {
    const outcome = await run1(renderModel(stateDef("<%= it.vars.nope.deeper %>"), context())).then(
      () => "resolved" as const,
      (e: Error) => e,
    )
    expect(outcome).not.toBe("resolved")
    expect(outcome).toBeInstanceOf(Error)
  })
})

describe("renderLabel", () => {
  const stateDef = (label?: string): StateDef =>
    label !== undefined ? { actor: "agent", prompt: "x", label } : { actor: "agent", prompt: "x" }

  const run1 = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

  it("a state with no `label:` renders to `undefined`", async () => {
    const result = await run1(renderLabel(stateDef(), context()))
    expect(result).toBeUndefined()
  })

  it("a plain string with no Eta tags passes through unchanged", async () => {
    const result = await run1(renderLabel(stateDef("planning"), context()))
    expect(result).toBe("planning")
  })

  it("a templated `label:` resolves against the same `it.vars` the content sees", async () => {
    const result = await run1(
      renderLabel(stateDef("<%= it.vars.labelName %>"), context({ vars: { labelName: "review" } })),
    )
    expect(result).toBe("review")
  })

  it("a label render failure propagates as a thrown/rejected error, same as a content render failure", async () => {
    const outcome = await run1(renderLabel(stateDef("<%= it.vars.nope.deeper %>"), context())).then(
      () => "resolved" as const,
      (e: Error) => e,
    )
    expect(outcome).not.toBe("resolved")
    expect(outcome).toBeInstanceOf(Error)
  })
})

describe("renderFile", () => {
  const stateDefWithFile = (file?: string): StateDef =>
    file !== undefined ? { actor: "agent", prompt: "x", file } : { actor: "agent", prompt: "x" }

  const run2 = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

  it("a state with no `file:` renders to `undefined`", async () => {
    const result = await run2(renderFile(stateDefWithFile(), context()))
    expect(result).toBeUndefined()
  })

  it("a plain string with no Eta tags passes through unchanged", async () => {
    const result = await run2(renderFile(stateDefWithFile(".gtd/FEEDBACK.md"), context()))
    expect(result).toBe(".gtd/FEEDBACK.md")
  })

  it("a templated `file:` resolves against the same `it.vars` the content sees", async () => {
    const result = await run2(
      renderFile(
        stateDefWithFile("<%= it.vars.todoFile %>"),
        context({ vars: { todoFile: ".gtd/TODO.md" } }),
      ),
    )
    expect(result).toBe(".gtd/TODO.md")
  })

  it("a file render failure propagates as a thrown/rejected error, same as a content render failure", async () => {
    const outcome = await run2(
      renderFile(stateDefWithFile("<%= it.vars.nope.deeper %>"), context()),
    ).then(
      () => "resolved" as const,
      (e: Error) => e,
    )
    expect(outcome).not.toBe("resolved")
    expect(outcome).toBeInstanceOf(Error)
  })
})
