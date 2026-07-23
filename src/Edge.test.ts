import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import type { GitOperations } from "./Git.js"
import {
  computeProcessRun,
  executeDecision,
  pendingChanges,
  renderFile,
  renderMemory,
  renderModel,
  resolveVars,
  toTemplateEdges,
} from "./Edge.js"
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

const notImplemented = (name: string) => () =>
  Effect.fail(new Error(`${name} should not have been called by this test`))

/** A `GitOperations` stub with every method failing by default — tests override just what they exercise, so an unexpected call fails loudly instead of silently succeeding. */
const stubGit = (overrides: Partial<GitOperations>): GitOperations => ({
  diffHead: notImplemented("diffHead"),
  lastCommitSubject: notImplemented("lastCommitSubject"),
  hasCommits: notImplemented("hasCommits"),
  diffRef: notImplemented("diffRef"),
  resolveRef: notImplemented("resolveRef"),
  readRefOption: notImplemented("readRefOption"),
  isAncestor: notImplemented("isAncestor"),
  topLevel: notImplemented("topLevel"),
  commitHistory: notImplemented("commitHistory"),
  commitDiff: notImplemented("commitDiff"),
  changedPaths: notImplemented("changedPaths"),
  commitAllWithPrefix: notImplemented("commitAllWithPrefix"),
  softResetTo: notImplemented("softResetTo"),
  commitAsIs: notImplemented("commitAsIs"),
  discardPending: notImplemented("discardPending"),
  updateRef: notImplemented("updateRef"),
  deleteRef: notImplemented("deleteRef"),
  mixedResetTo: notImplemented("mixedResetTo"),
  restoreStagedFrom: notImplemented("restoreStagedFrom"),
  addIntentToAdd: notImplemented("addIntentToAdd"),
  ...overrides,
})

const run = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

/**
 * A minimal definition for `computeProcessRun`'s tests: only `idle`'s
 * `initial: true` matters to the boundary walk (`initialStateOf` never looks
 * up any OTHER state named in test history, e.g. "grilling"/"building" below
 * — the walk only compares parsed state names against the initial state's
 * NAME as a string).
 */
const def: WorkflowDefinition = {
  states: { idle: { actor: "human", message: "m", initial: true } },
}

describe("computeProcessRun", () => {
  it("an empty repo has an empty run, the empty-tree sentinel as start parent", async () => {
    const git = stubGit({ hasCommits: () => Effect.succeed(false) })
    const result = await run(computeProcessRun(git, def))
    expect(result).toEqual({
      startHash: "",
      startParentHash: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      trace: [],
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
      trace: ["grilling", "building"],
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
    expect(result.trace).toEqual(["grilling"])
  })

  it("no workflow commit at HEAD (a fresh non-workflow boundary) is an empty run whose start is HEAD itself", async () => {
    const history = [{ hash: "h0", message: "chore: squashed", removedErrors: false, touched: [] }]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git, def))
    expect(result).toEqual({ startHash: "h0", startParentHash: "h0", trace: [] })
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
      trace: ["grilling", "building"],
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
    expect(result).toEqual({ startHash: "h2", startParentHash: "h2", trace: [] })
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
    expect(result.trace).toEqual(["grilling"])
    expect(result.trace.filter((state) => state === "fixing")).toHaveLength(0)
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

const context = (overrides: Partial<TemplateContext> = {}): TemplateContext => ({
  startCommit: "start",
  currentCommit: "current",
  previousCommit: "previous",
  state: "squashing",
  actor: "agent",
  processDiff: "",
  lastDiff: "",
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
        { startHash: "s", startParentHash: "p", trace: ["grilling"] },
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

  it("a squash decision renders, soft-resets, commits as-is, and discards the rest", async () => {
    const softResetTo = vi.fn(() => Effect.succeed(undefined))
    const commitAsIs = vi.fn(() => Effect.succeed(undefined))
    const discardPending = vi.fn(() => Effect.succeed(undefined))
    const git = stubGit({ softResetTo, commitAsIs, discardPending })
    const outcome = await run(
      executeDecision(
        git,
        { startHash: "s", startParentHash: "parent-hash", trace: ["squashing"] },
        { kind: "squash", state: "done", template: "feat: <%= it.state %>" },
        context({ state: "done" }),
      ),
    )
    expect(outcome).toEqual({ kind: "squash", subject: "feat: done" })
    expect(softResetTo).toHaveBeenCalledWith("parent-hash")
    expect(commitAsIs).toHaveBeenCalledWith("feat: done")
    expect(discardPending).toHaveBeenCalledOnce()
  })

  it("a failed commit-template render refuses the step, touching nothing", async () => {
    const git = stubGit({}) // every git method fails if called
    const decision = await run(
      executeDecision(
        git,
        { startHash: "s", startParentHash: "parent-hash", trace: [] },
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
        { startHash: "s", startParentHash: "p", trace: [] },
        { kind: "noop", state: "idle" },
        context(),
      ),
    )
    expect(outcome).toEqual({ kind: "noop", state: "idle" })
  })
})

describe("resolveVars — the three-layer `it.vars` merge (workflow < rc < env)", () => {
  it("with only a workflow default, that default wins", () => {
    expect(resolveVars({ testCommand: "npm test" }, {}, {})).toEqual({
      testCommand: "npm test",
    })
  })

  it("a `.gtdrc` `vars:` entry overrides the workflow's own default for the same name", () => {
    expect(
      resolveVars(
        { testCommand: "npm test", reviewer: "alice" },
        { testCommand: "npm run check" },
        {},
      ),
    ).toEqual({ testCommand: "npm run check", reviewer: "alice" })
  })

  it("a `GTD_VAR_`-prefixed environment variable beats both the workflow default and the rc value", () => {
    expect(
      resolveVars(
        { testCommand: "npm test" },
        { testCommand: "npm run check" },
        { GTD_VAR_testCommand: "echo env-wins" },
      ),
    ).toEqual({ testCommand: "echo env-wins" })
  })

  it("an env var may introduce a name neither config layer declared", () => {
    expect(resolveVars({}, {}, { GTD_VAR_brandNew: "hello" })).toEqual({ brandNew: "hello" })
  })

  it("matches the `GTD_VAR_` prefix by exact remaining case — `testCommand`, not `testcommand`", () => {
    expect(resolveVars({}, {}, { GTD_VAR_testCommand: "a", GTD_VAR_TESTCOMMAND: "b" })).toEqual({
      testCommand: "a",
      TESTCOMMAND: "b",
    })
  })

  it("ignores env entries without the `GTD_VAR_` prefix, and an unset (`undefined`-valued) entry", () => {
    expect(
      resolveVars({}, {}, { PATH: "/usr/bin", GTD_VAR_kept: "yes", GTD_VAR_unset: undefined }),
    ).toEqual({ kept: "yes" })
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

describe("renderMemory", () => {
  const stateDef = (memory?: string): StateDef =>
    memory !== undefined ? { actor: "agent", prompt: "x", memory } : { actor: "agent", prompt: "x" }

  const run1 = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

  it("a state with no `memory:` renders to `undefined`", async () => {
    const result = await run1(renderMemory(stateDef(), context()))
    expect(result).toBeUndefined()
  })

  it("a plain label with no Eta tags passes through unchanged", async () => {
    const result = await run1(renderMemory(stateDef("plan"), context()))
    expect(result).toBe("plan")
  })

  it("a templated `memory:` resolves against the same `it.vars` the content sees", async () => {
    const result = await run1(
      renderMemory(
        stateDef("<%= it.vars.planScope %>"),
        context({ vars: { planScope: "grilling" } }),
      ),
    )
    expect(result).toBe("grilling")
  })

  it("a memory render failure propagates as a thrown/rejected error, same as a content render failure", async () => {
    const outcome = await run1(
      renderMemory(stateDef("<%= it.vars.nope.deeper %>"), context()),
    ).then(
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
