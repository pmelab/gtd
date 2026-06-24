import { describe, expect, it } from "vitest"
import { type GtdEvent, MAX_VERIFY_ITERATIONS, type ResolvePayload, resolve } from "./Machine.js"

const commit = (isTestFix: boolean): GtdEvent => ({ type: "COMMIT", isTestFix })

const basePayload = (overrides: Partial<ResolvePayload>): ResolvePayload => ({
  errorsPresent: false,
  reviewApprovedNoChanges: false,
  reviewModified: false,
  reviewUnmodified: false,
  codeDirty: false,
  hasPackages: false,
  gtdDirExists: false,
  todoDirty: null,
  todoExists: false,
  todoStatus: null,
  todoOpenQuestionsPresent: false,
  bangPresent: false,
  reviewPresent: false,
  reviewBasePresent: false,
  lastCommitSubject: "chore: init",
  workingTreeClean: true,
  packages: [],
  diff: "",
  ...overrides,
})

const resolveEvent = (overrides: Partial<ResolvePayload>): GtdEvent => ({
  type: "RESOLVE",
  payload: basePayload(overrides),
})

describe("resolve — COMMIT counter folding", () => {
  it("empty stream → 0", () => {
    const { context } = resolve([])
    expect(context.verifyIterations).toBe(0)
  })

  it("N trailing isTestFix:true → N", () => {
    const { context } = resolve([commit(true), commit(true), commit(true)])
    expect(context.verifyIterations).toBe(3)
  })

  it("reset: [fix, fix, non-fix, fix] → 1", () => {
    const { context } = resolve([commit(true), commit(true), commit(false), commit(true)])
    expect(context.verifyIterations).toBe(1)
  })

  it("[fix, fix, fix] → 3", () => {
    const { context } = resolve([commit(true), commit(true), commit(true)])
    expect(context.verifyIterations).toBe(3)
  })
})

describe("resolve — RESOLVE leaf + tag priority", () => {
  it("reviewModified (no outside code dirty) → review-process, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: true,
        codeDirty: false,
        hasPackages: true,
        gtdDirExists: true,
      }),
    ])
    expect(value).toBe("review-process")
    expect(autoAdvance).toBe(true)
  })

  it("codeDirty wins over reviewModified (verbatim-first) → code-changes", () => {
    const { value } = resolve([resolveEvent({ reviewModified: true, codeDirty: true })])
    expect(value).toBe("code-changes")
  })

  it("codeDirty → code-changes, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: false,
        codeDirty: true,
        hasPackages: true,
        gtdDirExists: true,
      }),
    ])
    expect(value).toBe("code-changes")
    expect(autoAdvance).toBe(true)
  })

  it("hasPackages → execute, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: false,
        codeDirty: false,
        hasPackages: true,
        gtdDirExists: true,
      }),
    ])
    expect(value).toBe("execute")
    expect(autoAdvance).toBe(true)
  })

  it("gtdDirExists only → cleanup, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: false,
        codeDirty: false,
        hasPackages: false,
        gtdDirExists: true,
      }),
    ])
    expect(value).toBe("cleanup")
    expect(autoAdvance).toBe(true)
  })

  it("todoStatus simple → execute-simple, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ todoExists: true, todoStatus: "simple" }),
    ])
    expect(value).toBe("execute-simple")
    expect(autoAdvance).toBe(true)
  })

  it("todoStatus complete → decompose, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ todoExists: true, todoStatus: "complete" }),
    ])
    expect(value).toBe("decompose")
    expect(autoAdvance).toBe(true)
  })

  it("errorsPresent → escalate, autoAdvance false", () => {
    const { value, autoAdvance } = resolve([resolveEvent({ errorsPresent: true })])
    expect(value).toBe("escalate")
    expect(autoAdvance).toBe(false)
  })

  it("grilling + clean + open questions → await-answers gate, autoAdvance false", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        todoExists: true,
        todoStatus: "grilling",
        todoDirty: null,
        todoOpenQuestionsPresent: true,
      }),
    ])
    expect(value).toBe("await-answers")
    expect(autoAdvance).toBe(false)
  })

  it("grilling + dirty → modified-todo (re-grill)", () => {
    const { value } = resolve([
      resolveEvent({ todoExists: true, todoStatus: "grilling", todoDirty: "modified" }),
    ])
    expect(value).toBe("modified-todo")
  })

  it("markerless clean committed TODO → new-todo (first grill)", () => {
    const { value } = resolve([
      resolveEvent({ todoExists: true, todoStatus: null, todoDirty: null }),
    ])
    expect(value).toBe("new-todo")
  })

  it("reviewUnmodified → await-review gate, autoAdvance false", () => {
    const { value, autoAdvance } = resolve([resolveEvent({ reviewUnmodified: true })])
    expect(value).toBe("await-review")
    expect(autoAdvance).toBe(false)
  })

  it("approved review with a !! comment diverts to review-process, not close", () => {
    const { value } = resolve([
      resolveEvent({ reviewApprovedNoChanges: true, reviewModified: true, bangPresent: true }),
    ])
    expect(value).toBe("review-process")
  })

  it("reviewPresent + reviewModified + codeDirty → review-process (not code-changes)", () => {
    const { value } = resolve([
      resolveEvent({
        reviewPresent: true,
        reviewModified: true,
        reviewApprovedNoChanges: false,
        codeDirty: true,
      }),
    ])
    expect(value).toBe("review-process")
  })

  it("reviewPresent + reviewUnmodified + codeDirty → await-review (not code-changes)", () => {
    const { value } = resolve([
      resolveEvent({ reviewPresent: true, reviewUnmodified: true, codeDirty: true }),
    ])
    expect(value).toBe("await-review")
  })

  it("codeDirty + !reviewPresent → code-changes (regression)", () => {
    const { value } = resolve([resolveEvent({ codeDirty: true, reviewPresent: false })])
    expect(value).toBe("code-changes")
  })

  it("counter ≥ cap → escalate, autoAdvance false", () => {
    const events: Array<GtdEvent> = []
    for (let i = 0; i < MAX_VERIFY_ITERATIONS; i++) events.push(commit(true))
    events.push(resolveEvent({ todoDirty: "new" }))
    const { value, autoAdvance } = resolve(events)
    expect(value).toBe("escalate")
    expect(autoAdvance).toBe(false)
  })

  it('todoDirty "new" → new-todo, autoAdvance true', () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ todoExists: true, todoDirty: "new" }),
    ])
    expect(value).toBe("new-todo")
    expect(autoAdvance).toBe(true)
  })

  it('todoDirty "modified" → modified-todo, autoAdvance true', () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ todoExists: true, todoDirty: "modified" }),
    ])
    expect(value).toBe("modified-todo")
    expect(autoAdvance).toBe(true)
  })

  it("clean + reviewBasePresent + non-empty refDiff → human-review, autoAdvance false", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewBasePresent: true,
        refDiff: "diff --git a/x b/x\n+hello\n",
        baseRef: "abc123",
      }),
    ])
    expect(value).toBe("human-review")
    expect(autoAdvance).toBe(false)
  })

  it("clean + no review base → verified, autoAdvance false", () => {
    const { value, autoAdvance } = resolve([resolveEvent({ reviewBasePresent: false })])
    expect(value).toBe("verified")
    expect(autoAdvance).toBe(false)
  })

  it("reviewBasePresent true but whitespace-only refDiff → verified (not human-review)", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ reviewBasePresent: true, refDiff: "   \n  ", baseRef: "abc123" }),
    ])
    expect(value).toBe("verified")
    expect(autoAdvance).toBe(false)
  })

  it("reviewBasePresent true but empty refDiff → verified (not human-review)", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ reviewBasePresent: true, refDiff: "", baseRef: "abc123" }),
    ])
    expect(value).toBe("verified")
    expect(autoAdvance).toBe(false)
  })

  it("reviewApprovedNoChanges → close-review, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([resolveEvent({ reviewApprovedNoChanges: true })])
    expect(value).toBe("close-review")
    expect(autoAdvance).toBe(true)
  })

  it("ordering regression: reviewApprovedNoChanges + reviewModified → close-review wins", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ reviewApprovedNoChanges: true, reviewModified: true }),
    ])
    expect(value).toBe("close-review")
    expect(autoAdvance).toBe(true)
  })

  it("reviewApprovedNoChanges false + reviewModified true → review-process (unchanged behavior)", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ reviewApprovedNoChanges: false, reviewModified: true }),
    ])
    expect(value).toBe("review-process")
    expect(autoAdvance).toBe(true)
  })
})

describe("resolve — counter-vs-escalate interaction", () => {
  it("cap-many fix(gtd) COMMITs then a RESOLVE that would otherwise verify → escalate wins", () => {
    const events: Array<GtdEvent> = []
    for (let i = 0; i < MAX_VERIFY_ITERATIONS; i++) events.push(commit(true))
    events.push(resolveEvent({ reviewBasePresent: false }))
    const { value } = resolve(events)
    expect(value).toBe("escalate")
  })

  it("below cap then a verified RESOLVE → verified (not escalate)", () => {
    const events: Array<GtdEvent> = []
    for (let i = 0; i < MAX_VERIFY_ITERATIONS - 1; i++) events.push(commit(true))
    events.push(resolveEvent({ reviewBasePresent: false }))
    const { value } = resolve(events)
    expect(value).toBe("verified")
  })

  it("at cap, escalate wins over human-review", () => {
    const events: Array<GtdEvent> = []
    for (let i = 0; i < MAX_VERIFY_ITERATIONS; i++) events.push(commit(true))
    events.push(
      resolveEvent({
        reviewBasePresent: true,
        refDiff: "diff --git a/x b/x\n+hi\n",
        baseRef: "abc",
      }),
    )
    expect(resolve(events).value).toBe("escalate")
  })

  it("at cap, escalate wins over modified-todo", () => {
    const events: Array<GtdEvent> = []
    for (let i = 0; i < MAX_VERIFY_ITERATIONS; i++) events.push(commit(true))
    events.push(resolveEvent({ todoDirty: "modified" }))
    expect(resolve(events).value).toBe("escalate")
  })

  it("widened packages fact (taskContents + hasCommitMsg) survives applyPayload", () => {
    const { context } = resolve([
      resolveEvent({
        hasPackages: true,
        gtdDirExists: true,
        packages: [
          {
            name: "01-foo",
            tasks: ["01-task.md"],
            taskContents: [{ name: "01-task.md", content: "# Task body\n" }],
            hasCommitMsg: true,
          },
        ],
      }),
    ])
    expect(context.packages[0]!.taskContents).toEqual([
      { name: "01-task.md", content: "# Task body\n" },
    ])
    expect(context.packages[0]!.hasCommitMsg).toBe(true)
  })

  it("passthrough context fields are carried onto the leaf", () => {
    const { context } = resolve([
      resolveEvent({
        lastCommitSubject: "feat: thing",
        workingTreeClean: false,
        diff: "some diff",
        baseRef: "ref1",
        refDiff: "rd",
        reviewBasePresent: true,
      }),
    ])
    expect(context.lastCommitSubject).toBe("feat: thing")
    expect(context.workingTreeClean).toBe(false)
    expect(context.diff).toBe("some diff")
    expect(context.baseRef).toBe("ref1")
    expect(context.refDiff).toBe("rd")
  })
})
