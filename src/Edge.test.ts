import { Effect, Exit } from "effect"
import { describe, expect, it, vi } from "vitest"
import {
  currentRest,
  currentRun,
  memoryResumedFor,
  reviewBaseFor,
  resolveRestFrom,
  renderRest,
  restAt,
  TRUNCATION_NOTICE,
  snapshotFromRest,
  stalledAt,
  summaryRun,
  summaryTemplateContext,
  UNATTRIBUTED_MODEL,
  type ResolvedRest,
  type RestRequirements,
} from "./Edge.js"
import type { WorkflowDefinition } from "./PatternMachine.js"
import { InMemRepo, testLayers } from "./testing/index.js"

// A ref name gtd no longer writes or reads at all — kept as a literal here
// only to pin that `restAt` genuinely ignores a stray ref under this name.
const REVIEW_HEAD_REF = "refs/worktree/gtd/review-head"

/**
 * Coverage for `src/Edge.ts`'s public surface, driven through `InMemRepo` +
 * `testLayers` (the same precedent `src/program.test.ts` uses) rather
 * than hand-stubbed `GitOperations` — every remaining export needs a real
 * `ConfigService`/`WorktreeReader`/`EnvVars` alongside git, so a resolved
 * `Rest` is the natural unit of test. `resolveRestFrom` and `reviewBaseFor`
 * are pure and get their own direct unit tests; everything else is exercised
 * through `currentRest`/`restAt`. `planStep`/`planEntry`/`snapshotFromRest`
 * (the pure planning core) have their own coverage in `src/step/*.test.ts`.
 */

const provide = <A>(
  eff: Effect.Effect<A, Error, RestRequirements>,
  repo: InMemRepo,
  env: Readonly<Record<string, string | undefined>> = {},
): Promise<A> => Effect.runPromise(eff.pipe(Effect.provide(testLayers(repo, { env }))))

const provideExit = <A>(
  eff: Effect.Effect<A, Error, RestRequirements>,
  repo: InMemRepo,
  env: Readonly<Record<string, string | undefined>> = {},
): Promise<Exit.Exit<A, Error>> =>
  Effect.runPromiseExit(eff.pipe(Effect.provide(testLayers(repo, { env }))))

// ── resolveRestFrom — pure ───────────────────────────────────────────────────

describe("resolveRestFrom", () => {
  const def: WorkflowDefinition = {
    states: {
      idle: { actor: "human", message: "m", on: [["* **", "grilling"]] },
      grilling: { actor: "human", message: "g", on: [["* **", "idle"]] },
    },
    entries: { default: "idle", manual: [] },
  }

  it("an unparseable subject (e.g. empty, a fresh repo) resolves at the initial state", () => {
    const result = resolveRestFrom(def, "")
    expect(result).toEqual({
      ok: true,
      rest: { def, state: "idle", stateDef: def.states.idle, actor: "human" },
    })
  })

  it("a parseable subject naming a declared state resolves there", () => {
    const result = resolveRestFrom(def, "gtd(human): grilling")
    expect(result.ok).toBe(true)
    expect(result.ok && result.rest.state).toBe("grilling")
  })

  it("refuses when HEAD names a state the CURRENT workflow no longer declares", () => {
    const result = resolveRestFrom(def, "gtd(human): renamed-away")
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.message).toContain('HEAD rests at "renamed-away"')
    expect(!result.ok && result.error.message).toContain("gtd abandon")
  })

  it("refuses a state declaring no actor — a programmer error `validateDefinition` would normally catch first, but `resolveRestFrom` doesn't trust its input either", () => {
    const noActorDef: WorkflowDefinition = {
      states: { idle: { message: "m", on: [["* **", "idle"]] } },
      entries: { default: "idle", manual: [] },
    }
    const result = resolveRestFrom(noActorDef, "")
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.message).toBe(
      'gtd: resolved at state "idle" declaring no actor',
    )
  })
})

// ── reviewBaseFor — pure ─────────────────────────────────────────────────────

describe("reviewBaseFor", () => {
  const def: WorkflowDefinition = {
    states: {
      idle: { actor: "human", message: "i", on: [["* **", "checkpoint"]] },
      checkpoint: {
        actor: "human",
        message: "c",
        reviewBase: true,
        on: [["* **", "building"]],
      },
      building: { actor: "agent", prompt: "b", on: [["* **", "idle"]] },
    },
    entries: { default: "idle", manual: [] },
  }

  const runWith = (
    startParentHash: string,
    diffBase: string,
    trace: ReadonlyArray<{ state: string; hash: string }>,
  ) => ({
    startHash: trace[0]?.hash ?? startParentHash,
    startParentHash,
    diffBase,
    trace: trace.map((entry) => ({ ...entry, actor: "agent" })),
    costEntries: [],
    judgeVerdicts: [],
    entryVars: {},
    headTurn: undefined,
    closingHash: undefined,
  })

  it("falls back to run.diffBase when no in-process commit entered a reviewBase state", () => {
    const run = runWith("p", "p", [{ state: "building", hash: "h1" }])
    expect(reviewBaseFor(def, run)).toBe("p")
  })

  it("resolves to the most-recent in-process reviewBase-state commit", () => {
    const run = runWith("p", "p", [
      { state: "checkpoint", hash: "h1" },
      { state: "building", hash: "h2" },
    ])
    expect(reviewBaseFor(def, run)).toBe("h1")
  })

  it("picks the LATER of two reviewBase-state entries, not the first", () => {
    const run = runWith("p", "p", [
      { state: "checkpoint", hash: "h1" },
      { state: "building", hash: "h2" },
      { state: "checkpoint", hash: "h3" },
      { state: "building", hash: "h4" },
    ])
    expect(reviewBaseFor(def, run)).toBe("h3")
  })

  it("respects an overridden diffBase (a Gtd-Review-Base: entry commit) as the fallback", () => {
    const run = runWith("p", "entry-override", [{ state: "building", hash: "h1" }])
    expect(reviewBaseFor(def, run)).toBe("entry-override")
  })
})

// ── memoryResumedFor — pure ──────────────────────────────────────────────────

describe("memoryResumedFor", () => {
  const runWith = (trace: ReadonlyArray<{ state: string; hash: string }>) => ({
    startHash: trace[0]?.hash ?? "p",
    startParentHash: "p",
    diffBase: "p",
    trace: trace.map((entry) => ({ ...entry, actor: "agent" })),
    costEntries: [],
    judgeVerdicts: [],
    entryVars: {},
    headTurn: undefined,
    closingHash: undefined,
  })

  const restAtState = (def: WorkflowDefinition, state: string, actor = "agent"): ResolvedRest => ({
    def,
    state,
    stateDef: def.states[state]!,
    actor,
  })

  it("is false at a message rest, regardless of trace (never even looks at scope)", () => {
    const def: WorkflowDefinition = {
      states: {
        idle: { actor: "human", message: "i", on: [["* **", "build"]] },
        build: { actor: "agent", prompt: "b", on: [["* **", "idle"]] },
      },
      entries: { default: "idle", manual: [] },
    }
    const rest = restAtState(def, "idle", "human")
    expect(memoryResumedFor(def, { idle: "", build: "" }, rest, runWith([]))).toBe(false)
  })

  it("the root-scope trap: idle → build's first turn is false, not true", () => {
    // Without the prompt-content filter, `idle` would count as a "prior rest
    // in scope" purely because the root scope ("") matches every state.
    const def: WorkflowDefinition = {
      states: {
        idle: { actor: "human", message: "i", on: [["* **", "build"]] },
        build: { actor: "agent", prompt: "b", on: [["* **", "build"]] },
      },
      entries: { default: "idle", manual: [] },
    }
    const scopes = { idle: "", build: "" }
    const rest = restAtState(def, "build")
    expect(memoryResumedFor(def, scopes, rest, runWith([{ state: "build", hash: "h1" }]))).toBe(
      false,
    )
  })

  it("prompt-then-return: a second turn at the same prompt state is true", () => {
    const def: WorkflowDefinition = {
      states: {
        idle: { actor: "human", message: "i", on: [["* **", "build"]] },
        build: { actor: "agent", prompt: "b", on: [["* **", "build"]] },
      },
      entries: { default: "idle", manual: [] },
    }
    const scopes = { idle: "", build: "" }
    const rest = restAtState(def, "build")
    const run = runWith([
      { state: "build", hash: "h1" },
      { state: "build", hash: "h2" },
    ])
    expect(memoryResumedFor(def, scopes, rest, run)).toBe(true)
  })

  it("a script excursion in between doesn't break the run", () => {
    const def: WorkflowDefinition = {
      states: {
        idle: { actor: "human", message: "i", on: [["* **", "build"]] },
        build: { actor: "agent", prompt: "b", on: [["* **", "check"]] },
        check: { actor: "check", script: "c", on: [["* **", "build"]] },
      },
      entries: { default: "idle", manual: [] },
    }
    const scopes = { idle: "", build: "", check: "" }
    const rest = restAtState(def, "build")
    const run = runWith([
      { state: "build", hash: "h1" },
      { state: "check", hash: "h2" },
      { state: "build", hash: "h3" },
    ])
    expect(memoryResumedFor(def, scopes, rest, run)).toBe(true)
  })

  it("a sibling-scope excursion resets the run to false", () => {
    const def: WorkflowDefinition = {
      states: {
        idle: { actor: "human", message: "i", on: [["* **", "build"]] },
        build: { actor: "agent", prompt: "b", on: [["* **", "review"]] },
        review: { actor: "reviewer", prompt: "r", on: [["* **", "build"]] },
      },
      entries: { default: "idle", manual: [] },
    }
    const scopes = { idle: "", build: "build", review: "review" }
    const rest = restAtState(def, "build")
    const run = runWith([
      { state: "build", hash: "h1" },
      { state: "review", hash: "h2" },
      { state: "build", hash: "h3" },
    ])
    expect(memoryResumedFor(def, scopes, rest, run)).toBe(false)
  })

  it("a child-descendant excursion does NOT break the run", () => {
    const def: WorkflowDefinition = {
      states: {
        idle: { actor: "human", message: "i", on: [["* **", "build"]] },
        build: { actor: "agent", prompt: "b", on: [["* **", "buildChild"]] },
        buildChild: { actor: "child", prompt: "bc", on: [["* **", "build"]] },
      },
      entries: { default: "idle", manual: [] },
    }
    const scopes = { idle: "", build: "build", buildChild: "build.child" }
    const rest = restAtState(def, "build")
    const run = runWith([
      { state: "build", hash: "h1" },
      { state: "buildChild", hash: "h2" },
      { state: "build", hash: "h3" },
    ])
    expect(memoryResumedFor(def, scopes, rest, run)).toBe(true)
  })

  it("entries.default itself a prompt state: true once a turn returns to a sibling in its scope", () => {
    // The pre-trace prefix (`initialStateOf(def)`) is what makes this true —
    // without it, the very first landed turn would see an empty "prior
    // rests" slice and wrongly report false.
    const def: WorkflowDefinition = {
      states: {
        build: { actor: "agent", prompt: "b", on: [["* **", "buildRetry"]] },
        buildRetry: { actor: "agent", prompt: "br", on: [["* **", "buildRetry"]] },
      },
      entries: { default: "build", manual: [] },
    }
    const scopes = { build: "build", buildRetry: "build" }
    const rest = restAtState(def, "buildRetry")
    const run = runWith([{ state: "buildRetry", hash: "h1" }])
    expect(memoryResumedFor(def, scopes, rest, run)).toBe(true)
  })
})

// ── currentRun — the process-trace boundary walk, re-driven through the edge ─

const TRACE_WORKFLOW = [
  "workflow:",
  "  entry:",
  "    default: root",
  "  machines:",
  "    root:",
  "      entry: idle",
  "      states:",
  "        idle:",
  "          actor: human",
  "          message: i",
  "          on:",
  '            "* **": grilling',
  "        grilling:",
  "          actor: human",
  "          message: g",
  "          on:",
  '            "* **": building',
  "        building:",
  "          actor: agent",
  "          prompt: b",
  "          on:",
  '            "* **": checking',
  "        checking:",
  "          actor: agent",
  "          prompt: c",
  "          on:",
  '            "* **": idle',
  "        fixing:",
  "          entry: true",
  "          actor: agent",
  "          prompt: f",
  "          on:",
  '            "* **": fixing',
  "        reviewing:",
  "          entry: true",
  "          actor: human",
  "          message: r",
  "          on:",
  '            "* **": idle',
  "",
].join("\n")

const seededTraceRepo = (): { repo: InMemRepo; boundary: string } => {
  const repo = new InMemRepo()
  repo.writeFile(".gtdrc.yaml", TRACE_WORKFLOW)
  repo.commitAllWithPrefix("chore: add custom workflow")
  return { repo, boundary: repo.resolveRef("HEAD")! }
}

describe("currentRun", () => {
  it("a fresh non-workflow boundary is an empty run whose start is HEAD itself", async () => {
    const { repo, boundary } = seededTraceRepo()
    const run = await provide(currentRun, repo)
    expect(run).toEqual({
      startHash: boundary,
      startParentHash: boundary,
      diffBase: boundary,
      trace: [],
      costEntries: [],
      judgeVerdicts: [],
      entryVars: {},
    })
  })

  it("walks back to the nearest non-workflow boundary commit, collecting the trace", async () => {
    const { repo, boundary } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    const grilling = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(agent): building")
    const building = repo.resolveRef("HEAD")!
    const run = await provide(currentRun, repo)
    expect(run.startParentHash).toBe(boundary)
    expect(run.trace).toEqual([
      { state: "grilling", hash: grilling, actor: "human" },
      { state: "building", hash: building, actor: "agent" },
    ])
  })

  it("a commit entering the initial state mid-history is ALSO a process boundary, excluded from the newer process's trace", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(agent): building") // cycle 1
    repo.commitAllWithPrefix("gtd(human): idle") // boundary: approval rests at idle
    const idleBoundary = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(human): grilling") // cycle 2
    const grilling = repo.resolveRef("HEAD")!
    const run = await provide(currentRun, repo)
    expect(run.startParentHash).toBe(idleBoundary)
    expect(run.trace).toEqual([{ state: "grilling", hash: grilling, actor: "human" }])
  })

  it("retry counting resets across an idle boundary — a state entered repeatedly before it counts 0 after", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(agent): fixing")
    repo.commitAllWithPrefix("gtd(agent): fixing")
    repo.commitAllWithPrefix("gtd(agent): fixing")
    repo.commitAllWithPrefix("gtd(human): idle") // boundary
    repo.commitAllWithPrefix("gtd(human): grilling")
    const run = await provide(currentRun, repo)
    expect(run.trace.filter((entry) => entry.state === "fixing")).toHaveLength(0)
    expect(run.trace.map((e) => e.state)).toEqual(["grilling"])
  })

  it("collects the process's turn-commit Gtd-Cost: entries (with models), ignoring the boundary's", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling\n\nGtd-Cost: 120 opus")
    repo.commitAllWithPrefix("gtd(agent): building\n\nGtd-Cost: 300 haiku")
    repo.commitAllWithPrefix("gtd(agent): checking\n\nGtd-Cost: 50") // model-less
    const run = await provide(currentRun, repo)
    expect(run.costEntries).toEqual([
      { cost: 120, model: "opus" },
      { cost: 300, model: "haiku" },
      { cost: 50, model: UNATTRIBUTED_MODEL },
    ])
  })

  it("collects the process's turn-commit Gtd-Judge: entries — one per answered question, oldest first", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix(
      'gtd(agent): grilling\n\nGtd-Judge: {"id":"q1","answer":true,"p":0.97}',
    )
    repo.commitAllWithPrefix(
      "gtd(agent): building\n\n" +
        'Gtd-Judge: {"id":"q1","answer":"escalate","p":0.6}\n' +
        'Gtd-Judge: {"id":"q2","answer":3,"p":0.8}',
    )
    const run = await provide(currentRun, repo)
    expect(run.judgeVerdicts).toEqual([
      { id: "q1", answer: true, p: 0.97 },
      { id: "q1", answer: "escalate", p: 0.6 },
      { id: "q2", answer: 3, p: 0.8 },
    ])
  })

  it("skips a Gtd-Judge: trailer whose body isn't valid JSON rather than failing the whole scan", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(agent): grilling\n\nGtd-Judge: not json")
    const run = await provide(currentRun, repo)
    expect(run.judgeVerdicts).toEqual([])
  })

  it("a Gtd-Review-Base: trailer on the process's OLDEST commit overrides diffBase, leaving startParentHash untouched", async () => {
    const { repo, boundary } = seededTraceRepo()
    repo.commitAllWithPrefix(`gtd(human): reviewing\n\nGtd-Review-Base: ${boundary}deadbeef`)
    const run = await provide(currentRun, repo)
    expect(run.startParentHash).toBe(boundary)
    expect(run.diffBase).toBe(`${boundary}deadbeef`)
  })

  it("a Gtd-Review-Base: trailer on a LATER turn is never consulted for the override", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): reviewing")
    repo.commitAllWithPrefix("gtd(human): idle\n\nGtd-Review-Base: not-the-real-base")
    // "idle" is the initial state, so this commit is itself the NEW boundary
    // (excluded from the run above it) — the trailer it carries is on the
    // boundary commit, never the process's own oldest commit, so it is
    // never consulted; the fresh, empty run's diffBase is just its own hash.
    const idleBoundary = repo.resolveRef("HEAD")!
    const run = await provide(currentRun, repo)
    expect(run.trace).toEqual([])
    expect(run.diffBase).toBe(run.startParentHash)
    expect(run.startParentHash).toBe(idleBoundary)
  })

  it("collects Gtd-Var: entries off the process's OLDEST commit into entryVars", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix(
      "gtd(human): reviewing\n\nGtd-Var: base=refs/heads/main\nGtd-Var: reviewer=alice",
    )
    const run = await provide(currentRun, repo)
    expect(run.entryVars).toEqual({ base: "refs/heads/main", reviewer: "alice" })
  })

  describe("headTurn", () => {
    it("fills in with an empty turn's own state and empty: true", async () => {
      const { repo } = seededTraceRepo()
      repo.commitAllWithPrefix("gtd(agent): building") // no files touched
      const run = await provide(currentRun, repo)
      expect(run.headTurn).toEqual({ state: "building", actor: "agent", empty: true })
    })

    it("reports empty: false for a turn that actually changed something", async () => {
      const { repo } = seededTraceRepo()
      repo.writeFile("NOTES.md", "hi\n")
      repo.commitAllWithPrefix("gtd(agent): building")
      const run = await provide(currentRun, repo)
      expect(run.headTurn).toEqual({ state: "building", actor: "agent", empty: false })
    })

    it("is undefined for a foreign/unparseable HEAD subject", async () => {
      const { repo } = seededTraceRepo()
      const run = await provide(currentRun, repo)
      expect(run.headTurn).toBeUndefined()
    })
  })
})

// ── summaryRun — currentRun's twin, boundary-INCLUSIVE at a closed process ──

describe("summaryRun", () => {
  it("a process still in flight (HEAD is not itself a closing boundary) resolves identically to currentRun", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    repo.commitAllWithPrefix("gtd(agent): building")
    const [ordinary, summary] = await Promise.all([
      provide(currentRun, repo),
      provide(summaryRun, repo),
    ])
    expect(summary).toEqual(ordinary)
    expect(summary.closingHash).toBeUndefined()
  })

  it("HEAD itself a commit entering the initial state: the closing commit is folded into the trace and its hash recorded", async () => {
    const { repo, boundary } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    const grilling = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(agent): building")
    const building = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(human): idle") // closes the process — "idle" is TRACE_WORKFLOW's initial state
    const closing = repo.resolveRef("HEAD")!

    const ordinary = await provide(currentRun, repo)
    // currentRun excludes the boundary commit itself — an empty trace, and
    // startParentHash is the closing commit's own hash (the new boundary).
    expect(ordinary.trace).toEqual([])
    expect(ordinary.startParentHash).toBe(closing)

    const summary = await provide(summaryRun, repo)
    expect(summary.closingHash).toBe(closing)
    expect(summary.trace).toEqual([
      { state: "grilling", hash: grilling, actor: "human" },
      { state: "building", hash: building, actor: "agent" },
      { state: "idle", hash: closing, actor: "human" },
    ])
    // The boundary-inclusive walk continues past the closing commit to the
    // PREVIOUS process boundary — the non-workflow commit before grilling.
    expect(summary.startParentHash).toBe(boundary)
  })

  it("once something else lands on top of the closing commit, it is no longer reachable this way — the walk stops at the new, unparseable HEAD", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    repo.commitAllWithPrefix("gtd(agent): building")
    repo.commitAllWithPrefix("gtd(human): idle") // closes the process
    repo.commitAllWithPrefix("chore: unrelated commit on top") // breaks the boundary walk

    const summary = await provide(summaryRun, repo)
    expect(summary.closingHash).toBeUndefined()
    expect(summary.trace).toEqual([])
  })
})

// ── summaryTemplateContext — the context `gtd summary` renders against ──────

describe("summaryTemplateContext", () => {
  it("resolves a stateless/actorless, edge-less context off a run, with reviewBase/processBase/vars carried through", async () => {
    const { repo, boundary } = seededNotesRepo()
    repo.commitAllWithPrefix("gtd(human): checkpoint")
    const checkpoint = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(agent): thinking")
    const head = repo.resolveRef("HEAD")!

    const context = await provide(
      Effect.gen(function* () {
        const run = yield* summaryRun
        return yield* summaryTemplateContext(run)
      }),
      repo,
    )

    expect(context.state).toBe("")
    expect(context.actor).toBe("")
    expect(context.edges).toEqual([])
    expect(context.startCommit).toBe(boundary)
    expect(context.currentCommit).toBe(head)
    expect(context.previousCommit).toBe(checkpoint)
    expect(context.processBase).toBe(boundary)
    expect(context.reviewBase).toBe(checkpoint)
    expect(context.vars.testCommand).toBe("npm test")
    expect(context.processCost).toBe(0)
    expect(context.processCostByModel).toEqual([])
  })

  it("folds the closing commit into reviewBase/processBase the same way when the process is already closed", async () => {
    const { repo } = seededNotesRepo()
    repo.commitAllWithPrefix("gtd(human): checkpoint")
    const checkpoint = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(agent): thinking")
    repo.commitAllWithPrefix("gtd(human): idle") // closes back to NOTES_WORKFLOW's initial state
    const closing = repo.resolveRef("HEAD")!

    const context = await provide(
      Effect.gen(function* () {
        const run = yield* summaryRun
        return yield* summaryTemplateContext(run)
      }),
      repo,
    )

    expect(context.currentCommit).toBe(closing)
    // "checkpoint" is still the most recent reviewBase-state commit in the
    // (now boundary-inclusive) trace.
    expect(context.reviewBase).toBe(checkpoint)
  })
})

// ── currentRest — the fully-resolved snapshot ────────────────────────────────

const NOTES_WORKFLOW = [
  "workflow:",
  "  vars:",
  "    testCommand: npm test",
  "    suffix: ''",
  "  entry:",
  "    default: root",
  "  machines:",
  "    root:",
  '      model: "<%= it.vars.testCommand %>"',
  '      system: "system-<%= it.vars.testCommand %>"',
  "      entry: idle",
  "      states:",
  "        idle:",
  "          actor: human",
  "          message: idle-message",
  "          on:",
  '            "* **": checkpoint',
  "        checkpoint:",
  "          actor: human",
  "          message: checkpoint-message",
  "          reviewBase: true",
  "          on:",
  '            "* **": thinking',
  "        thinking:",
  "          actor: agent",
  '          label: "label-<%= it.vars.testCommand %>"',
  "          file: NOTES.md",
  "          mode: qa",
  '          prompt: "think about <%= it.vars.testCommand %>"',
  "          on:",
  '            "A NOTE<%= it.vars.suffix %>.md": thinking',
  "",
].join("\n")

const seededNotesRepo = (): { repo: InMemRepo; boundary: string } => {
  const repo = new InMemRepo()
  repo.writeFile(".gtdrc.yaml", NOTES_WORKFLOW)
  repo.commitAllWithPrefix("chore: add custom workflow")
  return { repo, boundary: repo.resolveRef("HEAD")! }
}

describe("currentRest — one snapshot: cost folding, per-model grouping, entryVars, reviewBase, memory", () => {
  it("folds process-trace cost entries per model, layers entryVars over the workflow default, resolves reviewBase off the reviewBase-state commit, and computes the memory key", async () => {
    const { repo, boundary } = seededNotesRepo()
    repo.commitAllWithPrefix("gtd(human): checkpoint\n\nGtd-Var: testCommand=echo entry-var")
    const checkpoint = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(agent): thinking\n\nGtd-Cost: 120 opus")
    repo.commitAllWithPrefix("gtd(agent): thinking\n\nGtd-Cost: 300 haiku")

    const rest = await provide(currentRest, repo)

    expect(rest.state).toBe("thinking")
    expect(rest.actor).toBe("agent")
    expect(rest.vars.testCommand).toBe("echo entry-var")
    expect(rest.context.processCost).toBe(420)
    expect(rest.context.processCostByModel).toEqual([
      { model: "haiku", cost: 300 },
      { model: "opus", cost: 120 },
    ])
    expect(rest.context.reviewBase).toBe(checkpoint)
    expect(rest.hints.model).toBe("echo entry-var")
    expect(rest.hints.system).toBe("system-echo entry-var")
    expect(rest.hints.label).toBe("label-echo entry-var")
    expect(rest.hints.file).toBe(".gtd/NOTES.md")
    expect(rest.hints.mode).toBe("qa")
    // "thinking" is a root-scoped (unqualified) prompt state; the run's
    // unbroken scope entry started at trace position 0 (checkpoint), so the
    // memory token anchors to the commit BEFORE it — the boundary commit.
    expect(rest.memory).toBe(`root#${boundary.slice(0, 7)}`)
  })

  it("renders on edges' Eta patterns against it.vars before the plan sees them", async () => {
    const { repo } = seededNotesRepo()
    repo.commitAllWithPrefix("gtd(human): checkpoint")
    repo.commitAllWithPrefix("gtd(agent): thinking")
    const rest = await provide(currentRest, repo)
    expect(rest.on).toEqual([["A NOTE.md", "thinking"]])
  })

  it("renders routes:' minP/maxP Eta templates against it.vars before the plan sees them, onto rest.stepDef — the same rendering renderRoutes/withRenderedOn apply for step()", async () => {
    const ROUTES_WORKFLOW = [
      "workflow:",
      "  vars:",
      "    floor: '0.7'",
      "    ceiling: '0.95'",
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: judging",
      "      states:",
      "        judging:",
      "          actor: human",
      "          message: verdict needed",
      "          judge: '{}'",
      "          routes:",
      "            - question: verdict",
      "              is: identical",
      "              minP: <%= it.vars.floor %>",
      "              maxP: <%= it.vars.ceiling %>",
      "              to: escalate",
      "            - to: proceed",
      "        escalate:",
      "          actor: human",
      "          message: escalate",
      "        proceed:",
      "          actor: human",
      "          message: proceed",
      "",
    ].join("\n")
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", ROUTES_WORKFLOW)
    repo.commitAllWithPrefix("chore: add routes workflow")
    const rest = await provide(currentRest, repo)
    expect(rest.stepDef.states["judging"]!.routes).toEqual([
      { question: "verdict", is: "identical", minP: "0.7", maxP: "0.95", to: "escalate" },
      { to: "proceed" },
    ])
  })

  it("omits `system` (never `undefined`-valued) when the resting machine declares none", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    expect(rest.hints).not.toHaveProperty("system")
  })

  it("carries an edge's `describe`/`action` into it.edges when declared, and omits both keys entirely (never `undefined`-valued) when not", async () => {
    const EDGES_WORKFLOW = [
      "workflow:",
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: idle",
      "      states:",
      "        idle:",
      "          actor: human",
      "          message: idle-message",
      "          on:",
      '            "A FOO.md":',
      "              to: working",
      "              describe: adds FOO.md",
      "              action: review FOO",
      '            "A BAR.md": working',
      "        working:",
      "          actor: agent",
      "          prompt: work-prompt",
      "          on:",
      '            "* **": idle',
      "",
    ].join("\n")
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", EDGES_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    const rest = await provide(currentRest, repo)
    expect(rest.context.edges).toEqual([
      { pattern: "A FOO.md", target: "working", describe: "adds FOO.md", action: "review FOO" },
      { pattern: "A BAR.md", target: "working" },
    ])
    expect(rest.context.edges[1]).not.toHaveProperty("describe")
    expect(rest.context.edges[1]).not.toHaveProperty("action")
  })

  it("a malformed on-pattern template surfaces as a plain Error", async () => {
    const BROKEN_PATTERN_WORKFLOW = [
      "workflow:",
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: idle",
      "      states:",
      "        idle:",
      "          actor: human",
      "          message: hi",
      "          on:",
      '            "A <%= it.vars.nope.deeper %>.md": idle',
      "",
    ].join("\n")
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", BROKEN_PATTERN_WORKFLOW)
    repo.commitAllWithPrefix("chore: add broken workflow")
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("restAt(ref) resolves a different state than currentRest on the same repo", async () => {
    const { repo, boundary } = seededNotesRepo()
    repo.commitAllWithPrefix("gtd(human): checkpoint")
    const atHead = await provide(currentRest, repo)
    const atBoundary = await provide(restAt(boundary), repo)
    expect(atHead.state).toBe("checkpoint")
    expect(atBoundary.state).toBe("idle")
  })
})

describe("currentRest — narrates the resolved rest", () => {
  it("narrates the resolved state and actor, on the stderr-shaped channel — Narrator, not a return value", async () => {
    const { repo } = seededNotesRepo()
    repo.commitAllWithPrefix("gtd(human): checkpoint")
    repo.commitAllWithPrefix("gtd(agent): thinking")
    const lines: string[] = []
    await Effect.runPromise(
      currentRest.pipe(Effect.provide(testLayers(repo, { narrate: (line) => lines.push(line) }))),
    )
    // Config resolution narrates its own layer(s) first (`Config.ts`), then
    // the rest resolver narrates which rest resolved (`Edge.ts`) — both fire
    // for one `currentRest` call, since resolving a rest always loads config.
    expect(lines).toContain("rest resolved: thinking (awaits agent)\n")
    expect(lines.some((l) => l.startsWith("config: layer "))).toBe(true)
  })

  it("narrates nothing when no narrate sink is given (the default no-op — matches no --verbose)", async () => {
    const { repo } = seededNotesRepo()
    repo.commitAllWithPrefix("gtd(human): checkpoint")
    // Should not throw even though nothing observes the narration.
    await expect(provide(currentRest, repo)).resolves.toBeDefined()
  })
})

describe("currentRest — var layering: workflow < rc < entry commit < env", () => {
  const VARS_WORKFLOW = [
    "workflow:",
    "  vars:",
    "    testCommand: npm test",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: idle",
    "      states:",
    "        idle:",
    "          actor: human",
    "          message: hi",
    "          on:",
    '            "* **": grilling',
    "        grilling:",
    "          actor: human",
    "          message: g",
    "          on:",
    '            "* **": idle',
    "",
    "vars:",
    "  testCommand: npm run rc",
    "",
  ].join("\n")

  const seeded = (): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", VARS_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it("a .gtdrc vars: entry overrides the workflow's own default", async () => {
    const repo = seeded()
    const rest = await provide(currentRest, repo)
    expect(rest.vars.testCommand).toBe("npm run rc")
  })

  it("an entry commit's Gtd-Var: trailer overrides both the workflow default and the rc value", async () => {
    const repo = seeded()
    repo.commitAllWithPrefix("gtd(human): grilling\n\nGtd-Var: testCommand=npm run entry")
    const rest = await provide(currentRest, repo)
    expect(rest.vars.testCommand).toBe("npm run entry")
  })

  it("a GTD_<UPPERCASE> env var beats every other layer", async () => {
    const repo = seeded()
    repo.commitAllWithPrefix("gtd(human): grilling\n\nGtd-Var: testCommand=npm run entry")
    const rest = await provide(currentRest, repo, { GTD_TESTCOMMAND: "echo env-wins" })
    expect(rest.vars.testCommand).toBe("echo env-wins")
  })

  it("ignores a GTD_* env var matching no declared name", async () => {
    const repo = seeded()
    const rest = await provide(currentRest, repo, { GTD_BRANDNEW: "hello" })
    expect(rest.vars["brandnew"]).toBeUndefined()
    expect(Object.keys(rest.vars)).not.toContain("brandnew")
  })
})

// ── planStep — decide, then guard; a driver lands the emitted script ─────────

const STEP_WORKFLOW = [
  "workflow:",
  "  vars:",
  "    base: ''",
  "  entry:",
  "    default: root",
  "  machines:",
  "    root:",
  "      entry: idle",
  "      states:",
  "        idle:",
  "          actor: human",
  "          message: idle-message",
  "          on:",
  '            "* **": working',
  "        working:",
  "          actor: agent",
  "          prompt: work-prompt",
  "          on:",
  '            "A PLAN.md": accepted',
  "        probing:",
  "          entry: true",
  "          actor: check",
  "          script: probe-script",
  "          on:",
  '            "A PLAN.md": accepted',
  "        accepted:",
  "          actor: human",
  "          message: accepted-message",
  "          on:",
  '            "* **": idle',
  "        fixing:",
  "          entry: true",
  "          actor: agent",
  "          prompt: fix-prompt",
  "          on:",
  '            "C": idle',
  "        reviewcheck:",
  "          entry: true",
  "          actor: human",
  "          message: reviewcheck-message",
  '          reviewBase: "<%= it.vars.base %>"',
  "          on:",
  '            "* **": idle',
  "",
].join("\n")

const seededStepRepo = (): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile(".gtdrc.yaml", STEP_WORKFLOW)
  repo.commitAllWithPrefix("chore: add custom workflow")
  return repo
}

// ── snapshotFromRest — the one place a Rest becomes a RepoSnapshot ──────────

const REVERT_WORKFLOW = [
  "workflow:",
  "  entry:",
  "    default: root",
  "  machines:",
  "    root:",
  "      entry: idle",
  "      states:",
  "        idle:",
  "          actor: human",
  "          message: idle-message",
  "          on:",
  '            "* **": reviewed',
  "        reviewed:",
  "          actor: human",
  "          message: reviewed-message",
  "          reviewBase: true",
  "          on:",
  '            "* **": awaitRevert',
  "        awaitRevert:",
  "          actor: agent",
  "          prompt: work-prompt",
  "          requireRevert: true",
  "          file: AWAIT.md",
  "          on:",
  '            "* **": idle',
  "",
].join("\n")

/**
 * Two crafted turn commits landing at `awaitRevert` (`requireRevert: true`)
 * having passed through `reviewed` (`reviewBase: true`) — the one shape that
 * makes `reviewBase` genuinely differ from `startCommit`, which is what lets
 * `requireRevertGuard`'s early "no identifiable review round" exit be told
 * apart from an actual git-archaeology read in the assertions below.
 */
const revertRepo = (): InMemRepo => {
  const repo = new InMemRepo()
  repo.writeFile(".gtdrc.yaml", REVERT_WORKFLOW)
  repo.commitAllWithPrefix("chore: add custom workflow")
  // A real code-path touch on the `reviewed` commit itself — the require-
  // revert guard's residue check only calls `changedPaths` when the review
  // round's own commits touched a scoped (non-`.gtd/`) path at all.
  repo.writeFile("src/reviewed.ts", "reviewed\n")
  repo.commitAllWithPrefix("gtd(human): idle → reviewed")
  repo.commitAllWithPrefix("gtd(human): reviewed → awaitRevert")
  return repo
}

describe("snapshotFromRest", () => {
  it("gates the require-revert probe's git archaeology behind isRequireRevertState AND not-an-attempt", async () => {
    const repo = revertRepo()

    // Clean tree at `awaitRevert` (agent, prompt) invoked by its own actor —
    // an ATTEMPT by construction. `enforceStepGuards` bypasses every guard
    // for one, so the probe must not run either. The spies are installed
    // AFTER `currentRest` resolves — `computeProcessRun` itself always calls
    // `commitHistory()` (no args) to walk the trace, which is unrelated to
    // the probe this test isolates.
    const attemptRest = await provide(currentRest, repo)
    const attemptHistorySpy = vi.spyOn(repo, "commitHistory")
    const attemptChangedSpy = vi.spyOn(repo, "changedPathsWorktree")
    const attemptSnapshot = await provide(snapshotFromRest(attemptRest), repo)
    expect(attemptSnapshot.revert).toEqual({ checked: false, base: "", residue: [] })
    expect(attemptHistorySpy).not.toHaveBeenCalled()
    expect(attemptChangedSpy).not.toHaveBeenCalled()

    // A dirty tree matching `"* **"` is an ordinary (non-attempt) commit —
    // the probe must run, and the history it finds resolves the residue.
    repo.writeFile("src/a.ts", "hi\n")
    const commitRest = await provide(currentRest, repo)
    const commitHistorySpy = vi.spyOn(repo, "commitHistory")
    const commitChangedSpy = vi.spyOn(repo, "changedPathsWorktree")
    const commitSnapshot = await provide(snapshotFromRest(commitRest), repo)
    expect(commitSnapshot.revert.checked).toBe(true)
    expect(commitHistorySpy).toHaveBeenCalled()
    expect(commitChangedSpy).toHaveBeenCalled()
  })

  it("skips the probe entirely at a state that doesn't declare requireRevert", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    const historySpy = vi.spyOn(repo, "commitHistory")
    const snapshot = await provide(snapshotFromRest(rest), repo)
    expect(snapshot.revert).toEqual({ checked: false, base: "", residue: [] })
    expect(historySpy).not.toHaveBeenCalled()
  })

  it("reads headFile/worktreeFile whenever the resting state declares a file", async () => {
    const repo = revertRepo()
    // Uncommitted — HEAD's subject must stay `gtd(human): reviewed →
    // awaitRevert` for `resolveState` to keep resting at `awaitRevert`.
    repo.writeFile(".gtd/AWAIT.md", "pending content\n")
    const rest = await provide(currentRest, repo)
    const snapshot = await provide(snapshotFromRest(rest), repo)
    expect(snapshot.file).toBe(".gtd/AWAIT.md")
    expect(snapshot.headFile).toBeUndefined()
    expect(snapshot.worktreeFile).toBe("pending content\n")
  })
})

// ── restAt — always resolves against real HEAD (Part C) ─────────────────────

describe("restAt — resolves against real HEAD, with no window ref to consult", () => {
  it("currentRest resolves against real HEAD even when a stray refs/worktree/gtd/review-head ref exists", async () => {
    const { repo, boundary } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    const grilling = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(agent): building")

    // A ref under this name is no longer written or read by anything — this
    // pins that `restAt` genuinely ignores it, not just that nothing sets it.
    repo.updateRef(REVIEW_HEAD_REF, grilling)

    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("building")
    expect(rest.run.trace.map((e) => e.state)).toEqual(["grilling", "building"])
    expect(rest.run.startParentHash).toBe(boundary)
  })

  it("restAt(ref) resolves at the given ref", async () => {
    const { repo, boundary } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    repo.commitAllWithPrefix("gtd(agent): building")

    const atBoundary = await provide(restAt(boundary), repo)
    expect(atBoundary.state).toBe("idle")
  })
})

// ── stalledAt — the derived stall, a pure fold over the resolved rest ───────

describe("stalledAt", () => {
  it("is true: a clean tree, HEAD is an empty attempt at the resting no-C prompt state", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(agent): building") // clean tree -> empty commit
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("building")
    expect(stalledAt(rest)).toBe(true)
  })

  it("is false on a dirty tree", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(agent): building")
    repo.writeFile("scratch.txt", "x\n")
    const rest = await provide(currentRest, repo)
    expect(stalledAt(rest)).toBe(false)
  })

  it("is false when HEAD's own turn actually changed something", async () => {
    const { repo } = seededTraceRepo()
    repo.writeFile("NOTES.md", "hi\n")
    repo.commitAllWithPrefix("gtd(agent): building")
    const rest = await provide(currentRest, repo)
    expect(stalledAt(rest)).toBe(false)
  })

  it("is false when the resting state declares a C row (a clean step would fire it, not attempt)", async () => {
    const repo = seededStepRepo() // STEP_WORKFLOW's "fixing": prompt, on: [["C", "idle"]]
    repo.commitAllWithPrefix("gtd(agent): fixing") // clean tree -> empty commit
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("fixing")
    expect(stalledAt(rest)).toBe(false)
  })

  it("is false once a retry cap would redirect the next attempt elsewhere", async () => {
    // "working" must NOT be the workflow's own initial state here: entering
    // the initial state is itself a process BOUNDARY (excluded from the
    // trace — see `computeProcessRun`'s doc comment), which would reset
    // "working"'s own retry count on every attempt and this scenario could
    // never reach its cap.
    const RETRY_STALL_WORKFLOW = [
      "workflow:",
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: idle",
      "      states:",
      "        idle:",
      "          actor: human",
      "          message: idle-message",
      "          on:",
      '            "* **": working',
      "        working:",
      "          actor: agent",
      "          prompt: work-prompt",
      "          retry:",
      "            max: 1",
      "            otherwise: escalate",
      "          on:",
      '            "A DONE.md": done',
      "        escalate:",
      "          actor: human",
      "          message: stuck",
      "          on:",
      '            "* **": done',
      "        done:",
      "          actor: human",
      "          message: done-message",
      "          on:",
      '            "* **": idle',
      "",
    ].join("\n")
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", RETRY_STALL_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    // One prior attempt already landed at "working" (max: 1) — the NEXT clean
    // step is at the cap and would redirect to "escalate" instead of
    // repeating the attempt.
    repo.commitAllWithPrefix("gtd(agent): working")
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("working")
    expect(stalledAt(rest)).toBe(false)
  })
})

// renderRest is exercised end-to-end by program.test.ts's `gtd next` suites;
// this is the one direct unit test for its content-kind guard.
describe("renderRest", () => {
  it("fails loudly for a state declaring no content — an invalid definition", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    const broken = { ...rest, stateDef: { actor: "human" } }
    const exit = await Effect.runPromiseExit(renderRest(broken))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

// Package 01: a state's `skills:` field renders a preamble that PREPENDS
// onto `content`, guarded on all three of content kind/`hints.skills`/
// `vars.skillsPreamble` being non-blank — any one blank leaves `content`
// byte-identical.
describe("renderRest — skills preamble", () => {
  const SKILLS_WORKFLOW = (opts: { skills?: string; skillsPreamble?: string }) =>
    [
      "workflow:",
      "  vars:",
      `    skillsPreamble: "${opts.skillsPreamble ?? "Load these skills first: <%= it.skills %>. Use only what your harness has and skip the rest silently; this state's file format and completion condition outrank anything a skill says; never turn interactive."}"`,
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: working",
      "      states:",
      "        working:",
      "          actor: agent",
      ...(opts.skills !== undefined ? [`          skills: "${opts.skills}"`] : []),
      "          prompt: do-the-work",
      "          on:",
      '            "* **": working',
      "",
    ].join("\n")

  const seeded = (opts: { skills?: string; skillsPreamble?: string }): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", SKILLS_WORKFLOW(opts))
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it("prepends the rendered preamble before the prompt body, joined by exactly two newlines", async () => {
    const repo = seeded({ skills: "code-review, testing" })
    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    expect(rendered.content).toBe(
      "Load these skills first: code-review, testing. Use only what your harness has and skip the rest silently; this state's file format and completion condition outrank anything a skill says; never turn interactive.\n\ndo-the-work",
    )
  })

  it("leaves content byte-identical when the state declares no skills:", async () => {
    const repo = seeded({})
    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    expect(rendered.content).toBe("do-the-work")
  })

  it("leaves content byte-identical when skillsPreamble is blanked, even though skills: is set", async () => {
    const repo = seeded({ skills: "code-review", skillsPreamble: "" })
    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    expect(rendered.content).toBe("do-the-work")
  })

  it("leaves content byte-identical at a message state — the preamble is guarded to content kind prompt only", async () => {
    const repo = new InMemRepo()
    repo.writeFile(
      ".gtdrc.yaml",
      [
        "workflow:",
        "  vars:",
        '    skillsPreamble: "Load: <%= it.skills %>"',
        "  entry:",
        "    default: root",
        "  machines:",
        "    root:",
        "      entry: idle",
        "      states:",
        "        idle:",
        "          actor: human",
        "          message: hello",
        "          on:",
        '            "* **": idle',
        "",
      ].join("\n"),
    )
    repo.commitAllWithPrefix("chore: add custom workflow")
    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    expect(rendered.content).toBe("hello")
  })

  it("a GTD_<NAME> env override of the state's skills var changes only that state's preamble", async () => {
    const repo = new InMemRepo()
    repo.writeFile(
      ".gtdrc.yaml",
      [
        "workflow:",
        "  vars:",
        "    reviewSkills: base-skill",
        '    skillsPreamble: "Load: <%= it.skills %>"',
        "  entry:",
        "    default: root",
        "  machines:",
        "    root:",
        "      entry: working",
        "      states:",
        "        working:",
        "          actor: agent",
        "          skills: <%= it.vars.reviewSkills %>",
        "          prompt: do-the-work",
        "          on:",
        '            "* **": working',
        "",
      ].join("\n"),
    )
    repo.commitAllWithPrefix("chore: add custom workflow")
    const rest = await provide(currentRest, repo, { GTD_REVIEWSKILLS: "env-skill" })
    const rendered = await provide(renderRest(rest), repo, { GTD_REVIEWSKILLS: "env-skill" })
    expect(rendered.content).toBe("Load: env-skill\n\ndo-the-work")
  })

  it("a malformed skills: template propagates out of the render, refusing the step", async () => {
    const repo = seeded({ skills: "<%= it.broken %" })
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("a malformed skillsPreamble var propagates out of the render, refusing the step", async () => {
    const repo = seeded({ skills: "code-review", skillsPreamble: "<%= it.skills %" })
    const rest = await provide(currentRest, repo)
    const exit = await Effect.runPromiseExit(renderRest(rest))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

// `.gtd/packages/01-bounded-judge-read-helper.md`'s "Every failure stays
// conservative" section: `judgeBudgetBytes` THROWS (never defaults) when a
// workflow DECLARES it and then blanks/breaks it — the one `vars:` key that
// refuses rather than silently disabling the mechanism it guards.
describe("judgeBudgetBytes — refuses rather than defaults when declared-but-unusable", () => {
  const BUDGET_WORKFLOW = (judgeBudgetBytes: string) =>
    [
      "workflow:",
      "  vars:",
      `    judgeBudgetBytes: "${judgeBudgetBytes}"`,
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: idle",
      "      states:",
      "        idle:",
      "          actor: human",
      "          message: hello",
      "          on:",
      '            "* **": idle',
      "",
    ].join("\n")

  const seeded = (judgeBudgetBytes: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", BUDGET_WORKFLOW(judgeBudgetBytes))
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it.each(["", "not-a-number", "NaN", "0", "-1", "1.5"])(
    "refuses to resolve the rest when judgeBudgetBytes is %j",
    async (value) => {
      const exit = await provideExit(currentRest, seeded(value))
      expect(Exit.isFailure(exit)).toBe(true)
    },
  )

  it("a numeric judgeBudgetBytes resolves fine", async () => {
    const rest = await provide(currentRest, seeded("32768"))
    expect(rest.state).toBe("idle")
  })
})

// The evidence rule, enforced for real: `restAt` renders `judge:` against
// `templateReadCommitted` (`git show HEAD:<path>`), a DIFFERENT `it.read`
// binding than every other `rest: "rendered"` field gets (`templateRead`, a
// plain working-tree read via `Workspace.readSync`) — see `src/Edge.ts`'s
// `renderHints`/`JUDGE_FIELD_KEY`. Package 01's Task 1: "a test asserts a
// `judge:` template cannot reach an uncommitted artifact."
describe("judge: rendering — the evidence rule (no gathering turn)", () => {
  const JUDGE_WORKFLOW = [
    "workflow:",
    "  entry:",
    "    default: root",
    "  machines:",
    "    root:",
    "      entry: a",
    "      states:",
    "        a:",
    "          actor: human",
    // The ordinary `message:` field reads the SAME path through the
    // ordinary working-tree `it.read` — proving the distinction is real,
    // not "nothing can read this path.".
    "          message: \"working-tree read: <%~ it.read('.gtd/SCRATCH.md') %>\"",
    '          judge: \'{ "state": "<%~ it.read(".gtd/SCRATCH.md") %>", "questions": [] }\'',
    "",
  ].join("\n")

  it("judge:'s it.read of an uncommitted artifact refuses rest resolution, even though the sibling message: field (an ordinary working-tree read) reaches the SAME path fine", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", JUDGE_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    // Written to the WORKING TREE only — never committed.
    repo.writeFile(".gtd/SCRATCH.md", "freshly gathered, ungoverned evidence")

    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit)).toBe(true)
    const failure = Exit.isFailure(exit) ? String(exit.cause) : ""
    expect(failure).toMatch(/ENOENT/)
    expect(failure).toMatch(/not committed/)
  })

  it("judge:'s it.read of an already-committed artifact renders fine — the evidence rule's positive case", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", JUDGE_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile(".gtd/SCRATCH.md", "governed evidence, committed by an earlier state")
    repo.commitAllWithPrefix("chore: commit scratch evidence")

    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    expect(rendered.judge).toBe(
      '{ "state": "governed evidence, committed by an earlier state", "questions": [] }',
    )
    expect(rendered.content).toBe(
      "working-tree read: governed evidence, committed by an earlier state",
    )
  })

  it("judge:'s it.read renders the COMMITTED version of an artifact that's since been EDITED in the working tree, ignoring the pending edit — unlike the sibling message: field, which reads the pending edit", async () => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", JUDGE_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    repo.writeFile(".gtd/SCRATCH.md", "the committed version")
    repo.commitAllWithPrefix("chore: commit scratch evidence")
    // Edited again after committing — pending, uncommitted content.
    repo.writeFile(".gtd/SCRATCH.md", "an uncommitted edit on top of the committed version")

    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    // The judge field renders the COMMITTED content, not the pending edit.
    expect(rendered.judge).toBe('{ "state": "the committed version", "questions": [] }')
    // The ordinary message: field reads the pending working-tree edit.
    expect(rendered.content).toBe(
      "working-tree read: an uncommitted edit on top of the committed version",
    )
  })
})

// `.gtd/packages/01-bounded-judge-read-helper.md`'s "Every over-budget render
// stays visible" section: the fixed sentence appears on a `message` rest
// ONLY when its ledger actually dropped bytes, never as standing boilerplate.
describe("renderRest — the truncation notice", () => {
  const TAIL_WORKFLOW = (judgeBudgetBytes: string) =>
    [
      "workflow:",
      "  vars:",
      `    judgeBudgetBytes: "${judgeBudgetBytes}"`,
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: a",
      "      states:",
      "        a:",
      "          actor: human",
      "          message: hello",
      '          judge: \'{ "state": <%~ JSON.stringify(it.tail(".gtd/BIG.md", 1)) %>, "questions": [] }\'',
      "",
    ].join("\n")

  const seeded = (judgeBudgetBytes: string, bigContent: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", TAIL_WORKFLOW(judgeBudgetBytes))
    repo.writeFile(".gtd/BIG.md", bigContent)
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it("appends the fixed sentence to message: when it.tail truncated the judge: field's evidence", async () => {
    const repo = seeded("20", "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\n")
    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    expect(rendered.content).toBe(`hello\n\n${TRUNCATION_NOTICE}`)
  })

  it("leaves content byte-identical when it.tail's bound never actually cuts anything", async () => {
    const repo = seeded("500", "short\n")
    const rest = await provide(currentRest, repo)
    const rendered = await provide(renderRest(rest), repo)
    expect(rendered.content).toBe("hello")
  })
})

// `.gtd/packages/02-payload-bound-engine.md` Requirement C: `it.tail`/
// `it.diffTail`/the two-argument `it.sections(path, share)` resolve only in a
// `judge:` field or a `message:` template — every other field is refused at
// WORKFLOW LOAD (a source-text scan, `PatternMachine.ts`'s
// `validateBoundedPrimitiveFields`), naming the call, before any step runs.
describe("bounded primitives narrowed to judge:/message: — load-time refusal (Requirement C)", () => {
  // All THREE bounded primitives get the same load-time/render-time coverage
  // — `it.diffTail` and the two-argument `it.sections(path, share)` are just
  // as disallowed outside judge:/message: as `it.tail`, and the load scan's
  // depth-aware paren walk (`hasTwoArgSectionsCall`) needs a real two-argument
  // `it.sections` call to exercise, not just `it.tail`.
  const CALLS = [
    { name: "it.tail", call: "<%~ it.tail('.gtd/BIG.md', 1) %>" },
    { name: "it.diffTail", call: "<%~ it.diffTail('HEAD', 1) %>" },
    {
      name: "it.sections(path, share)",
      call: "<%~ JSON.stringify(it.sections('.gtd/BIG.md', 1)) %>",
    },
  ]

  const workflowDeclaring = (fieldLines: readonly string[]): string =>
    [
      "workflow:",
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: a",
      "      states:",
      "        a:",
      "          actor: agent",
      ...fieldLines,
      "",
    ].join("\n")

  const seeded = (yaml: string): InMemRepo => {
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", yaml)
    repo.writeFile(".gtd/BIG.md", "some content\n")
    repo.commitAllWithPrefix("chore: add custom workflow")
    return repo
  }

  it.each(CALLS)("refuses a $name call in a prompt: field", async ({ call }) => {
    const repo = seeded(workflowDeclaring([`          prompt: "${call}"`]))
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit)).toBe(true)
    const failure = Exit.isFailure(exit) ? String(exit.cause) : ""
    expect(failure).toMatch(/allowed only in a "judge:" field or a "message:" template/)
  })

  it.each(CALLS)("refuses a $name call in a script: field", async ({ call }) => {
    const repo = seeded(workflowDeclaring([`          script: "${call}"`]))
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it.each(CALLS)("refuses a $name call in the label: hint field", async ({ call }) => {
    const repo = seeded(
      workflowDeclaring(["          prompt: hello", `          label: "${call}"`]),
    )
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it.each(CALLS)("refuses a $name call in the file: hint field", async ({ call }) => {
    const repo = seeded(workflowDeclaring(["          prompt: hello", `          file: "${call}"`]))
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it.each(CALLS)("refuses a $name call in the machine-level model: field", async ({ call }) => {
    const yaml = [
      "workflow:",
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      `      model: "${call}"`,
      "      entry: a",
      "      states:",
      "        a:",
      "          actor: agent",
      "          prompt: hello",
      "",
    ].join("\n")
    const repo = seeded(yaml)
    const exit = await provideExit(currentRest, repo)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it.each(CALLS)(
    "still allows the SAME $name call in a judge: field and a message: template",
    async ({ call }) => {
      const yaml = [
        "workflow:",
        "  entry:",
        "    default: root",
        "  machines:",
        "    root:",
        "      entry: a",
        "      states:",
        "        a:",
        "          actor: human",
        `          message: "${call}"`,
        // The judge field's own value must stay a valid YAML DOUBLE-quoted
        // scalar here — `call` itself carries single-quoted string
        // arguments, which would prematurely terminate a single-quoted YAML
        // wrapper (unlike the fixed one-off judge literal elsewhere in this
        // file, which deliberately uses double-quoted arguments instead).
        `          judge: "${call}"`,
        "",
      ].join("\n")
      const repo = seeded(yaml)
      const rest = await provide(currentRest, repo)
      expect(rest.state).toBe("a")
    },
  )

  it("the two-argument it.sections load scan is depth-aware: a NESTED call's own comma never trips it, but a genuine second argument does even when the first argument itself contains parens", async () => {
    const nested = seeded(
      workflowDeclaring([`          prompt: "<%~ it.sections(String(1,2)) %>"`]),
    )
    const rest = await provide(currentRest, nested)
    expect(rest.state).toBe("a")

    const genuine = seeded(
      workflowDeclaring([
        `          prompt: "<%~ JSON.stringify(it.sections(it.read('.gtd/BIG.md'), 0.5)) %>"`,
      ]),
    )
    const exit = await provideExit(currentRest, genuine)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("the one-argument it.sections(path) stays available on every template, never flagged by the load scan", async () => {
    const repo = seeded(
      workflowDeclaring([`          prompt: "<%~ JSON.stringify(it.sections('.gtd/BIG.md')) %>"`]),
    )
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("a")
  })
})

// The known gap the load-time scan accepts (`.gtd/packages/02-payload-bound-
// engine.md` Requirement C): an ALIASED or computed call
// (`const t = it.tail`) never appears as literal `it.tail(` source text, so
// the scan can't see it — the render-time throwing stub is the backstop that
// still refuses the step rather than truncating unannounced.
describe("bounded primitives narrowed to judge:/message: — the aliased-call backstop (Requirement C)", () => {
  it("a prompt: field that aliases it.tail before calling it evades the load-time scan but still refuses at render", async () => {
    const yaml = [
      "workflow:",
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: a",
      "      states:",
      "        a:",
      "          actor: agent",
      "          prompt: \"<% const t = it.tail %><%~ t('.gtd/BIG.md', 1) %>\"",
      "",
    ].join("\n")
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", yaml)
    repo.writeFile(".gtd/BIG.md", "some content\n")
    repo.commitAllWithPrefix("chore: add custom workflow")

    // Load succeeds — the scan can't see through the alias.
    const rest = await provide(currentRest, repo)
    // Render still refuses — the throwing stub is the backstop.
    const exit = await Effect.runPromiseExit(renderRest(rest))
    expect(Exit.isFailure(exit)).toBe(true)
    const failure = Exit.isFailure(exit) ? String(exit.cause) : ""
    expect(failure).toMatch(
      /it\.tail is available only in a "judge:" field or a "message:" template/,
    )
  })
})
