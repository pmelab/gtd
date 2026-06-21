import { describe, expect, it } from "vitest"
import { type GtdEvent, MAX_VERIFY_ITERATIONS, type ResolvePayload, resolve } from "./Machine.js"

const commit = (isFixGtd: boolean): GtdEvent => ({ type: "COMMIT", isFixGtd })

const basePayload = (overrides: Partial<ResolvePayload>): ResolvePayload => ({
  reviewModified: false,
  codeDirty: false,
  hasPackages: false,
  gtdDirExists: false,
  todoDirty: null,
  todoFinalized: false,
  todoSimple: false,
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

  it("N trailing isFixGtd:true → N", () => {
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
  it("reviewModified → review-process, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: true,
        codeDirty: true,
        hasPackages: true,
        gtdDirExists: true,
      }),
    ])
    expect(value).toBe("review-process")
    expect(autoAdvance).toBe(true)
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
        todoFinalized: true,
      }),
    ])
    expect(value).toBe("cleanup")
    expect(autoAdvance).toBe(true)
  })

  it("todoFinalized + todoSimple → execute-simple, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ todoFinalized: true, todoSimple: true }),
    ])
    expect(value).toBe("execute-simple")
    expect(autoAdvance).toBe(true)
  })

  it("todoFinalized without simple → decompose, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ todoFinalized: true, todoSimple: false }),
    ])
    expect(value).toBe("decompose")
    expect(autoAdvance).toBe(true)
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
    const { value, autoAdvance } = resolve([resolveEvent({ todoDirty: "new" })])
    expect(value).toBe("new-todo")
    expect(autoAdvance).toBe(true)
  })

  it('todoDirty "modified" → modified-todo, autoAdvance true', () => {
    const { value, autoAdvance } = resolve([resolveEvent({ todoDirty: "modified" })])
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
