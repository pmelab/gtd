import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import {
  currentRest,
  currentRun,
  planEntry,
  planStep,
  renderDecision,
  reviewBaseFor,
  resolveRestFrom,
  renderRest,
  restAt,
  UNATTRIBUTED_MODEL,
  type RestRequirements,
} from "./Edge.js"
import type { WorkflowDefinition } from "./PatternMachine.js"
import {
  commitAll,
  commitAsIs,
  discardPending,
  shellQuote,
  softResetTo,
  updateRef,
} from "./GitScript.js"
import { HISTORY_REF, withHistoryTrailer } from "./RetainedHistory.js"
import { commitOutcome, transitionOutcome } from "./OutcomeScript.js"
import { fakeGitOperations } from "./testing/GitDoubles.js"
import { InMemRepo } from "./testing/InMemRepo.js"
import { testLayers } from "./testing/Layers.js"

// The review checkout window's saved-head ref — duplicated here for the same
// reason `Edge.ts` duplicates it from `ReviewWindow.ts` rather than importing
// it (see `Edge.ts`'s own `REVIEW_HEAD_REF` doc comment).
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

const exitMessage = (exit: Exit.Exit<unknown, Error>): string =>
  Exit.isFailure(exit) ? String(exit.cause) : "(succeeded)"

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
    trace,
    costEntries: [],
    entryVars: {},
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
      { state: "grilling", hash: grilling },
      { state: "building", hash: building },
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
    expect(run.trace).toEqual([{ state: "grilling", hash: grilling }])
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
  "          file: .gtd/NOTES.md",
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

// ── planStep — decide, then guard, then perform ──────────────────────────────

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
  "        accepted:",
  '          commit: "chore: accepted <%= it.state %>"',
  "        fixing:",
  "          entry: true",
  "          actor: agent",
  "          prompt: fix-prompt",
  "          on:",
  '            "C": idle',
  "        broken:",
  "          entry: true",
  "          actor: agent",
  "          prompt: broken-prompt",
  "          on:",
  '            "A BROKEN.md": brokenAccepted',
  "        brokenAccepted:",
  '          commit: "<%= it.vars.nope.deeper %>"',
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
  it("a refusal (out-of-turn) touches nothing — no perform to even call", async () => {
    const repo = seededStepRepo()
    const before = repo.resolveRef("HEAD")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "agent"), repo) // idle awaits human
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("out of turn")
    expect(plan.kind === "refusal" && plan.reason).toBe("out-of-turn")
    expect(repo.resolveRef("HEAD")).toBe(before)
  })

  it("a refusal (no-match on a dirty tree) names the declared patterns", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): working")
    repo.writeFile("OTHER.md", "unrelated\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "agent"), repo)
    expect(plan.kind).toBe("refusal")
    expect(plan.kind === "refusal" && plan.message).toContain("A PLAN.md")
    expect(plan.kind === "refusal" && plan.reason).toBe("no-match")
  })

  it("a clean tree with no declared C row is a no-op — no write", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): working")
    const before = repo.resolveRef("HEAD")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "agent"), repo)
    expect(plan).toEqual({ kind: "noop", state: "working" })
    expect(repo.resolveRef("HEAD")).toBe(before)
  })

  it("a commit decision is inspectable and writes nothing until perform runs", async () => {
    const repo = seededStepRepo()
    repo.writeFile("README.md", "edited\n")
    const before = repo.resolveRef("HEAD")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "human"), repo)
    expect(plan.kind).toBe("commit")
    expect(plan.kind === "commit" && plan.decision.kind).toBe("commit")
    expect(repo.resolveRef("HEAD")).toBe(before)

    if (plan.kind !== "commit") throw new Error("expected a commit plan")
    const outcome = await provide(plan.perform, repo)
    expect(outcome).toEqual({ kind: "commit", subject: "gtd(human): idle → working" })
    expect(repo.lastCommitSubject()).toBe("gtd(human): idle → working")
  })

  it("a squash decision renders the commit template against the pending tree and discards the rest", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): working")
    repo.writeFile("PLAN.md", "the plan\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "agent"), repo)
    expect(plan.kind).toBe("squash")
    if (plan.kind !== "squash") throw new Error("expected a squash plan")

    const outcome = await provide(plan.perform, repo)
    expect(outcome).toEqual({ kind: "squash", subject: "chore: accepted accepted" })
    expect(repo.lastCommitSubject()).toBe("chore: accepted accepted")
    expect(repo.hasPath("PLAN.md")).toBe(false)
  })

  it("a failed commit-template render refuses the step during perform, touching nothing", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): broken-entry") // irrelevant boundary
    repo.hardResetTo(repo.resolveRef("HEAD~1")!) // back to a clean boundary at idle
    repo.commitAllWithPrefix("gtd(agent): broken")
    repo.writeFile("BROKEN.md", "x\n")
    const before = repo.resolveRef("HEAD")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "agent"), repo)
    expect(plan.kind).toBe("squash")
    if (plan.kind !== "squash") throw new Error("expected a squash plan")

    const exit = await provideExit(plan.perform, repo)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(exitMessage(exit)).toContain('rendering the "brokenAccepted" commit template failed')
    expect(repo.resolveRef("HEAD")).toBe(before)
  })

  it("a green re-entry into the initial state retaining nothing is mixed-reset, not committed", async () => {
    const repo = seededStepRepo()
    const entryRest = await provide(currentRest, repo)
    const entryPlan = await provide(
      planEntry(entryRest, "human", { state: "fixing", commandLabel: "gtd test", vars: {} }),
      repo,
    )
    if (entryPlan.kind !== "entry") throw new Error("expected an entry plan")
    await provide(entryPlan.perform, repo)

    // Resting at "fixing" with a clean tree: "C": idle, and the entry commit
    // above produced no net diff — retainsNothing is true.
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("fixing")
    const plan = await provide(planStep(rest, "agent"), repo)
    expect(plan.kind).toBe("commit")
    if (plan.kind !== "commit") throw new Error("expected a commit plan")

    const outcome = await provide(plan.perform, repo)
    expect(outcome).toEqual({ kind: "reset", state: "idle" })
    // Resolves back at idle, the entry commit rewound rather than piled on.
    const after = await provide(currentRest, repo)
    expect(after.state).toBe("idle")
    // The collapse branch lands no commit, so its script prints no outcome —
    // no `gtd_report_*` call, and no OUTCOME_PREAMBLE pulled in for it.
    expect(plan.scripts.required).not.toContain("gtd_report_")
    expect(plan.scripts.required).not.toContain(
      "# gtd: human-facing outcome rendering (see src/OutcomeScript.ts)",
    )
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

  it("refuses an entry into a commit (non-enterable) state", async () => {
    const repo = seededStepRepo()
    const rest = await provide(currentRest, repo)
    const plan = await provide(
      planEntry(rest, "human", { state: "accepted", commandLabel: "gtd test", vars: {} }),
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

  it("perform writes an entry commit carrying Gtd-Var: trailers, capturing whatever the tree carries", async () => {
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

    const outcome = await provide(plan.perform, repo)
    expect(outcome).toEqual({ kind: "entry", state: "fixing", subject: "gtd(human): fixing" })
    expect(repo.lastCommitMessage()).toBe("gtd(human): fixing\n\nGtd-Var: base=custom")
    expect(repo.hasPath("NOTES.md")).toBe(true)

    const after = await provide(currentRest, repo)
    expect(after.state).toBe("fixing")
    expect(after.vars.base).toBe("custom")
  })
})

// ── renderDecision + the plan's `scripts` field — render/perform equivalence ─

describe("renderDecision + StepPlan/EntryPlan.scripts", () => {
  it("a commit decision renders to one commitAll(withCostTrailer(...)) line, byte-identical to what perform commits", async () => {
    const repo = seededStepRepo()
    repo.writeFile("README.md", "edited\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "human", { cost: 7, model: "haiku" }), repo)
    if (plan.kind !== "commit" || plan.decision.kind !== "commit") {
      throw new Error("expected a commit plan")
    }

    // Direct call — `renderDecision` never reads `RestRequirements`, only the
    // `GitOperations` it's handed, so it needs no `provide`.
    const git = fakeGitOperations(repo)
    const steps = await Effect.runPromise(
      renderDecision(git, rest, plan.decision, rest.context, 7, "haiku"),
    )
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
    const git = fakeGitOperations(repo)
    // Hand-built rather than decided by `planStep`: `STEP_WORKFLOW` has no
    // declared self-loop, but `renderDecision` only reads `decision.from`/
    // `to`/`subject` plus `rest.def`/`rest.run` — a synthetic `StepCommit`
    // exercises its from === to branch directly.
    const decision = {
      kind: "commit" as const,
      subject: "gtd(agent): working",
      actor: "agent",
      from: "working",
      to: "working",
    }
    const steps = await Effect.runPromise(
      renderDecision(git, rest, decision, rest.context, undefined, undefined),
    )
    expect(steps).toEqual([
      { kind: "gitWrite", command: commitAll(decision.subject) },
      { kind: "outcome", command: commitOutcome("gtd(agent): working") },
    ])
  })

  it("a squash decision's assembled script emits retain-history, soft-reset, commit-as-is, and discard-pending in order, with resolved hashes inlined, agreeing with what perform writes", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): working")
    repo.writeFile("PLAN.md", "the plan\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "agent"), repo)
    if (plan.kind !== "squash") throw new Error("expected a squash plan")

    const tip = repo.resolveRef("HEAD")! // the pre-squash tip both render and perform resolve
    const startParent = rest.run.startParentHash
    expect(tip).not.toBe(startParent) // retain-history must fire, not be skipped

    const expectedMessage = withHistoryTrailer("chore: accepted accepted", tip)
    const script = plan.scripts.required
    const retainIdx = script.indexOf(shellQuote(updateRef(HISTORY_REF, tip)))
    const resetIdx = script.indexOf(shellQuote(softResetTo(startParent)))
    const commitAsIsIdx = script.indexOf(shellQuote(commitAsIs(expectedMessage)))
    const discardIdx = script.indexOf(shellQuote(discardPending()))
    const outcomeIdx = script.indexOf(commitOutcome("chore: accepted accepted"))

    expect(retainIdx).toBeGreaterThan(-1)
    expect(resetIdx).toBeGreaterThan(retainIdx)
    expect(commitAsIsIdx).toBeGreaterThan(resetIdx)
    expect(discardIdx).toBeGreaterThan(commitAsIsIdx)
    // The trailing outcome names the rendered message's bare subject line —
    // last, so a file-row read of HEAD sees the commit that just landed.
    expect(outcomeIdx).toBeGreaterThan(discardIdx)

    const outcome = await provide(plan.perform, repo)
    expect(outcome).toEqual({ kind: "squash", subject: "chore: accepted accepted" })
    expect(repo.lastCommitMessage()).toBe(expectedMessage)
  })

  it("a commit-template render failure yields an EMPTY script, matching perform's own refusal", async () => {
    const repo = seededStepRepo()
    repo.commitAllWithPrefix("gtd(human): broken-entry") // irrelevant boundary
    repo.hardResetTo(repo.resolveRef("HEAD~1")!) // back to a clean boundary at idle
    repo.commitAllWithPrefix("gtd(agent): broken")
    repo.writeFile("BROKEN.md", "x\n")
    const rest = await provide(currentRest, repo)
    const plan = await provide(planStep(rest, "agent"), repo)
    expect(plan.kind).toBe("squash")
    if (plan.kind !== "squash") throw new Error("expected a squash plan")

    expect(plan.scripts.required).toBe("")
    expect(plan.scripts.optional).toBe("")

    const exit = await provideExit(plan.perform, repo)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("planEntry's scripts field carries a single commitAll(message) line matching what perform commits", async () => {
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

    const outcome = await provide(plan.perform, repo)
    expect(outcome).toEqual({ kind: "entry", state: "fixing", subject: "gtd(human): fixing" })
    expect(repo.lastCommitMessage()).toBe(expectedMessage)
  })
})

// ── restAt — window-aware read (Part C) ──────────────────────────────────────

describe("restAt — the review checkout window's saved-head ref as HEAD", () => {
  it("currentRest resolves against the window's saved head — state, trace, and startParentHash all follow it", async () => {
    const { repo, boundary } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    const grilling = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(agent): building")
    const building = repo.resolveRef("HEAD")!

    // Simulate an OPEN review checkout window exactly as `openReviewWindow`
    // leaves it: the saved-head ref pins the real pre-window HEAD, while real
    // HEAD itself has been rewound (`git reset --mixed`) to an earlier commit.
    repo.updateRef(REVIEW_HEAD_REF, building)
    repo.mixedResetTo(grilling)

    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("building")
    expect(rest.run.trace.map((e) => e.state)).toEqual(["grilling", "building"])
    expect(rest.run.startParentHash).toBe(boundary)
  })

  it("falls through to today's exact behavior (real HEAD) when no window ref exists", async () => {
    const { repo } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    const rest = await provide(currentRest, repo)
    expect(rest.state).toBe("grilling")
    expect(rest.run.trace.map((e) => e.state)).toEqual(["grilling"])
  })

  it("restAt(ref) — visualize's own call pattern — never consults the window ref", async () => {
    const { repo, boundary } = seededTraceRepo()
    repo.commitAllWithPrefix("gtd(human): grilling")
    const grilling = repo.resolveRef("HEAD")!
    repo.commitAllWithPrefix("gtd(agent): building")
    const building = repo.resolveRef("HEAD")!
    repo.updateRef(REVIEW_HEAD_REF, building)
    repo.mixedResetTo(grilling)

    // Even with a window ref recorded, an EXPLICIT ref resolves at that ref,
    // exactly as before this package — this path is deliberately untouched.
    const atBoundary = await provide(restAt(boundary), repo)
    expect(atBoundary.state).toBe("idle")
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
