import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import {
  currentRest,
  currentRun,
  memoryResumedFor,
  planEntry,
  planStep,
  renderDecision,
  reviewBaseFor,
  resolveRestFrom,
  renderRest,
  restAt,
  stalledAt,
  summaryRun,
  summaryTemplateContext,
  UNATTRIBUTED_MODEL,
  type ResolvedRest,
  type RestRequirements,
} from "./Edge.js"
import type { WorkflowDefinition } from "./PatternMachine.js"
import { commitAll, shellQuote } from "./GitScript.js"
import { commitOutcome, transitionOutcome } from "./OutcomeScript.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { testLayers } from "./testing/Layers.js"
import { applyEmittedScript } from "./testing/EmittedScriptRecognizer.js"

/** Drive a plan's emitted `required` script into the fake — the same recognizer path `tests/integration/support/world.ts` uses. gtd itself never writes git; this is the driver's half of every landing below. */
const land = (repo: InMemRepo, scripts: { readonly required: string }): void => {
  const applied = applyEmittedScript(repo, new Map(), scripts.required)
  if (!applied.ok) throw new Error(applied.error ?? "emitted script failed")
}

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
 * through `currentRest`/`restAt`/`planStep`/`planEntry`.
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

  it("omits `system` (never `undefined`-valued) when the resting machine declares none", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    expect(rest.hints).not.toHaveProperty("system")
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

describe("planStep", () => {
  it("a refusal (no-match on a dirty tree) names the declared patterns", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): working")
    repo.writeFile("OTHER.md", "unrelated\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest), repo)
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("A PLAN.md")
  })

  it("a clean tree with no declared C row at a prompt rest is now an ATTEMPT commit, not a no-op", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): working")
    const before = repo.resolveRef("HEAD")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest), repo)
    expect(plan.kind).toBe("commit")
    if (plan.kind !== "commit") throw new Error("expected a commit plan")
    expect(plan.decision).toEqual({
      kind: "commit",
      subject: "gtd(agent): working",
      actor: "agent",
      from: "working",
      to: "working",
      attempt: true,
    })
    expect(repo.resolveRef("HEAD")).toBe(before)

    land(repo, plan.scripts)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): working")
    expect(repo.resolveRef("HEAD")).not.toBe(before)
  })

  it("a clean tree with no declared C row at a script rest is settled — the check ran and re-running it can't change that", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(check): probing")
    const before = repo.resolveRef("HEAD")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest), repo)
    expect(plan).toEqual({ kind: "noop", state: "probing", settled: true })
    expect(repo.resolveRef("HEAD")).toBe(before)
  })

  it("a commit decision is inspectable and writes nothing until the driver runs the emitted script", async () => {
    const repo = seededStepRepo()
    repo.writeFile("README.md", "edited\n")
    const before = repo.resolveRef("HEAD")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest), repo)
    expect(plan.kind).toBe("commit")
    expect(plan.kind === "commit" && plan.decision.kind).toBe("commit")
    expect(repo.resolveRef("HEAD")).toBe(before)

    if (plan.kind !== "commit") throw new Error("expected a commit plan")
    land(repo, plan.scripts)
    expect(repo.lastCommitSubject()).toBe("gtd(human): idle → working")
  })

  it("a matched on-edge to a non-initial target is an ordinary commit, not a collapse", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): working")
    repo.writeFile("PLAN.md", "the plan\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest), repo)
    expect(plan.kind).toBe("commit")
    if (plan.kind !== "commit") throw new Error("expected a commit plan")
    expect(plan.decision).toMatchObject({ kind: "commit", from: "working", to: "accepted" })

    land(repo, plan.scripts)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): working → accepted")
    expect(repo.hasPath("PLAN.md")).toBe(true)
  })

  it("a green re-entry into the initial state retaining nothing lands an ordinary commit, not a rewind", async () => {
    const repo = seededStepRepo()
    const entryRest = await provide(currentRest, repo)
    const entryPlan = await provide(
      planEntry(entryRest, "human", { state: "fixing", commandLabel: "gtd test", vars: {} }),
      repo,
    )
    if (entryPlan.kind !== "entry") throw new Error("expected an entry plan")
    land(repo, entryPlan.scripts)
    const afterEntry = repo.resolveRef("HEAD")

    // Resting at "fixing" with a clean tree: "C": idle, and the entry commit
    // above produced no net diff.
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("fixing")
    const plan = await provide(planStep(rest), repo)
    expect(plan.kind).toBe("commit")
    if (plan.kind !== "commit") throw new Error("expected a commit plan")

    land(repo, plan.scripts)
    // Lands an ordinary commit on top — HEAD never moves backward, and both
    // the entry commit and this probe commit stay in the log.
    const after = await provide(currentRest, repo)
    expect(after.state).toBe("idle")
    expect(repo.resolveRef("HEAD")).not.toBe(afterEntry)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): fixing → idle")
  })

  it("an attempt at a prompt state that IS the initial state lands an ordinary attempt commit", async () => {
    const ATTEMPT_INITIAL_WORKFLOW = [
      "workflow:",
      "  entry:",
      "    default: root",
      "  machines:",
      "    root:",
      "      entry: working",
      "      states:",
      "        working:",
      "          actor: agent",
      "          prompt: work-prompt",
      "          on:",
      '            "A DONE.md": done',
      "        done:",
      "          actor: human",
      "          message: done-message",
      "          on:",
      '            "* **": working',
      "",
    ].join("\n")
    const repo = new InMemRepo()
    repo.writeFile(".gtdrc.yaml", ATTEMPT_INITIAL_WORKFLOW)
    repo.commitAllWithPrefix("chore: add custom workflow")
    const before = repo.resolveRef("HEAD")

    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("working")
    const plan = await provide(planStep(rest), repo)
    expect(plan.kind).toBe("commit")
    if (plan.kind !== "commit") throw new Error("expected a commit plan")
    expect(plan.decision).toMatchObject({ attempt: true, from: "working", to: "working" })

    land(repo, plan.scripts)
    expect(repo.resolveRef("HEAD")).not.toBe(before)
    expect(repo.lastCommitSubject()).toBe("gtd(agent): working")
  })
})

// ── planEntry — starting a brand-new process ─────────────────────────────────

describe("planEntry", () => {
  it("refuses when a process is already underway", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): working")
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", { state: "fixing", commandLabel: "gtd test", vars: {} }),
      repo,
    )
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("already underway")
  })

  it("refuses an entry naming a state the workflow doesn't declare at all", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", { state: "nonexistent", commandLabel: "gtd test", vars: {} }),
      repo,
    )
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("not an enterable state")
  })

  it("refuses an undeclared --var name", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", {
        state: "fixing",
        commandLabel: "gtd test",
        vars: { nope: "x" },
      }),
      repo,
    )
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("not declared by this workflow")
  })

  it("refuses a blank-rendering reviewBase template", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", { state: "reviewcheck", commandLabel: "gtd test", vars: {} }),
      repo,
    )
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("rendered blank")
  })

  it("refuses a reviewBase that does not resolve to a commit", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", {
        state: "reviewcheck",
        commandLabel: "gtd test",
        vars: { base: "not-a-commit" },
      }),
      repo,
    )
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("does not resolve to a commit")
  })

  it("refuses a reviewBase equal to HEAD", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", {
        state: "reviewcheck",
        commandLabel: "gtd test",
        vars: { base: "HEAD" },
      }),
      repo,
    )
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("nothing to review")
  })

  it("refuses a reviewBase that is not an ancestor of HEAD", async () => {
    const repo = seededStepRepo()
    const branchPoint = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("chore: side branch commit")
    const sideCommit = repo.resolveRef("HEAD")!
    repo.hardResetTo(branchPoint)
    repo.commitAllWithPrefix("chore: main branch commit")

    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", {
        state: "reviewcheck",
        commandLabel: "gtd test",
        vars: { base: sideCommit },
      }),
      repo,
    )
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("is not an ancestor of HEAD")
  })

  it("the emitted script writes an entry commit carrying Gtd-Var: trailers, capturing whatever the tree carries", async () => {
    const repo = seededStepRepo()
    repo.writeFile("NOTES.md", "draft\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", {
        state: "fixing",
        commandLabel: "gtd test",
        vars: { base: "custom" },
      }),
      repo,
    )
    expect(plan.kind).toBe("entry")
    if (plan.kind !== "entry") throw new Error("expected an entry plan")
    expect(plan.subject).toBe("gtd(human): fixing")

    land(repo, plan.scripts)
    expect(repo.lastCommitMessage()).toBe("gtd(human): fixing\n\nGtd-Var: base=custom")
    expect(repo.hasPath("NOTES.md")).toBe(true)

    const after = await provide(currentRest, repo)
    expect(after.state).toBe("fixing")
    expect(after.vars.base).toBe("custom")
  })
})

// ── renderDecision + the plan's `scripts` field ──────────────────────────────

describe("renderDecision + StepPlan/EntryPlan.scripts", () => {
  it("a commit decision renders to one commitAll(withCostTrailer(...)) line, and the assembled script carries it", async () => {
    const repo = seededStepRepo()
    repo.writeFile("README.md", "edited\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, { cost: 7, model: "haiku" }), repo)
    if (plan.kind !== "commit" || plan.decision.kind !== "commit") {
      throw new Error("expected a commit plan")
    }

    // Direct call — `renderDecision` is pure, no `provide` needed.
    const steps = renderDecision(rest, plan.decision, 7, "haiku")
    const expectedMessage = `${plan.decision.subject}\n\nGtd-Cost: 7 haiku`
    expect(steps).toEqual([
      { kind: "gitWrite", command: commitAll(expectedMessage) },
      // idle -> working: a genuine transition, not a self-loop, so the
      // trailing outcome names both states rather than the bare subject.
      { kind: "outcome", command: transitionOutcome("idle", "working") },
    ])

    // The plan's assembled `scripts.required` carries the SAME line, wrapped
    // in the retry helper — proving Part B's assembly agrees with Part A's
    // renderer, not just a hand-built comparison.
    expect(plan.scripts.required).toContain(shellQuote(commitAll(expectedMessage)))
    expect(plan.scripts.required).toContain(transitionOutcome("idle", "working"))
  })

  it("a self-loop commit (from === to) renders a bare commitOutcome, not a transitionOutcome", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(agent): working")
    const rest = await provide(currentRest, repo)
    // Hand-built rather than decided by `planStep`: `STEP_WORKFLOW` has no
    // declared self-loop, but `renderDecision` only reads `decision.from`/
    // `to`/`subject` — a synthetic `StepCommit` exercises its from === to
    // branch directly.
    const decision = {
      kind: "commit" as const,
      subject: "gtd(agent): working",
      actor: "agent",
      from: "working",
      to: "working",
    }
    const steps = renderDecision(rest, decision, undefined, undefined)
    expect(steps).toEqual([
      { kind: "gitWrite", command: commitAll(decision.subject) },
      { kind: "outcome", command: commitOutcome("gtd(agent): working") },
    ])
  })

  it("planEntry's scripts field carries a single commitAll(message) line, and landing it writes the entry commit", async () => {
    const repo = seededStepRepo()
    repo.writeFile("NOTES.md", "draft\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", {
        state: "fixing",
        commandLabel: "gtd test",
        vars: { base: "custom" },
      }),
      repo,
    )
    if (plan.kind !== "entry") throw new Error("expected an entry plan")

    const expectedMessage = "gtd(human): fixing\n\nGtd-Var: base=custom"
    expect(plan.scripts.required).toContain(shellQuote(commitAll(expectedMessage)))
    // The trailing outcome names the BARE subject, never `expectedMessage`
    // (which carries the `Gtd-Var:` trailer).
    expect(plan.scripts.required).toContain(commitOutcome("gtd(human): fixing"))

    land(repo, plan.scripts)
    expect(repo.lastCommitMessage()).toBe(expectedMessage)
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
