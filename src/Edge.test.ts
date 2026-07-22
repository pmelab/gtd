import { Effect } from "effect"
import { describe, expect, it, vi } from "vitest"
import type { GitOperations } from "./Git.js"
import { computeProcessRun, executeDecision, pendingChanges } from "./Edge.js"
import type { TemplateContext } from "./PatternTemplates.js"

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
  statusPorcelain: notImplemented("statusPorcelain"),
  diffHead: notImplemented("diffHead"),
  lastCommitSubject: notImplemented("lastCommitSubject"),
  hasCommits: notImplemented("hasCommits"),
  diffRef: notImplemented("diffRef"),
  diffPath: notImplemented("diffPath"),
  resolveRef: notImplemented("resolveRef"),
  readRefOption: notImplemented("readRefOption"),
  topLevel: notImplemented("topLevel"),
  resolveDefaultBranch: notImplemented("resolveDefaultBranch"),
  mergeBase: notImplemented("mergeBase"),
  isAncestor: notImplemented("isAncestor"),
  lastDeletionOf: notImplemented("lastDeletionOf"),
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
  mixedResetHead: notImplemented("mixedResetHead"),
  resetHard: notImplemented("resetHard"),
  revertNoCommit: notImplemented("revertNoCommit"),
  removeGtdDir: notImplemented("removeGtdDir"),
  removePackageDir: notImplemented("removePackageDir"),
  ...overrides,
})

const run = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect)

describe("computeProcessRun", () => {
  it("an empty repo has an empty run, the empty-tree sentinel as start parent", async () => {
    const git = stubGit({ hasCommits: () => Effect.succeed(false) })
    const result = await run(computeProcessRun(git))
    expect(result).toEqual({
      startHash: "",
      startParentHash: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      trace: [],
    })
  })

  it("walks back to the nearest boundary commit, collecting the workflow run's trace", async () => {
    const history = [
      { hash: "h0", message: "chore: init", removedErrors: false, touched: [] },
      { hash: "h1", message: "gtd(agent): grilling", removedErrors: false, touched: [] },
      { hash: "h2", message: "gtd(human): grilling-answer", removedErrors: false, touched: [] },
    ]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git))
    expect(result).toEqual({
      startHash: "h1",
      startParentHash: "h0",
      trace: ["grilling", "grilling-answer"],
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
    const result = await run(computeProcessRun(git))
    expect(result.startParentHash).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904")
    expect(result.trace).toEqual(["grilling"])
  })

  it("no workflow commit at HEAD (a fresh boundary) is an empty run whose start is HEAD itself", async () => {
    const history = [{ hash: "h0", message: "chore: squashed", removedErrors: false, touched: [] }]
    const git = stubGit({
      hasCommits: () => Effect.succeed(true),
      commitHistory: () => Effect.succeed(history),
    })
    const result = await run(computeProcessRun(git))
    expect(result).toEqual({ startHash: "h0", startParentHash: "h0", trace: [] })
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
  config: undefined,
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
