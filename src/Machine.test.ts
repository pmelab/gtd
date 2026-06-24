import { describe, expect, it } from "vitest"
import {
  type GtdEvent,
  MAX_NO_AGENT_HOPS,
  MAX_VERIFY_ITERATIONS,
  type PendingCommitIntent,
  type ResolvePayload,
  resolve,
  start,
} from "./Machine.js"

const commit = (isTestFix: boolean): GtdEvent => ({ type: "COMMIT", isTestFix })

const basePayload = (overrides: Partial<ResolvePayload>): ResolvePayload => ({
  errorsPresent: false,
  reviewHasUncheckedBoxes: false,
  reviewHasRealFeedback: false,
  reviewModified: false,
  reviewUnmodified: false,
  codeDirty: false,
  hasPackages: false,
  gtdDirExists: false,
  todoDirty: null,
  todoExists: false,
  todoStatus: null,
  todoOpenQuestionsPresent: false,
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
  it("reviewModified + real feedback (no outside code dirty) → review-process, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: true,
        reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: true,
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

  it("hasPackages → runTestGate first (edgeAction runTestGate), then green TEST_RESULT → execute", () => {
    const handle = start([
      resolveEvent({
        reviewModified: false,
        codeDirty: false,
        hasPackages: true,
        gtdDirExists: true,
      }),
    ])
    // Settles on the gate, not execute yet.
    expect(handle.current.value).toBe("execute")
    expect(handle.current.edgeAction).toEqual({ kind: "runTestGate" })
    expect(handle.current.autoAdvance).toBe(false)
    // Green test → execute leaf, no edgeAction, auto-advance.
    const after = handle.advance([{ type: "TEST_RESULT", exitCode: 0, output: "" }])
    expect(after.value).toBe("execute")
    expect(after.edgeAction).toBeUndefined()
    expect(after.autoAdvance).toBe(true)
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

  it("reviewPresent + reviewModified + codeDirty → review-process (not code-changes)", () => {
    const { value } = resolve([
      resolveEvent({
        reviewPresent: true,
        reviewModified: true,
        reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: true,
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
    const { value, autoAdvance } = resolve([resolveEvent({ todoExists: true, todoDirty: "new" })])
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

  it("clean + reviewBasePresent + non-empty refDiff → human-review, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewBasePresent: true,
        refDiff: "diff --git a/x b/x\n+hello\n",
        baseRef: "abc123",
      }),
    ])
    expect(value).toBe("human-review")
    expect(autoAdvance).toBe(true)
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

  it("reviewModified + reviewHasUncheckedBoxes → review-incomplete, autoAdvance false", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({ reviewModified: true, reviewHasUncheckedBoxes: true }),
    ])
    expect(value).toBe("review-incomplete")
    expect(autoAdvance).toBe(false)
  })

  it("reviewModified + allChecked + no real feedback → close-review, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: true,
        reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: false,
      }),
    ])
    expect(value).toBe("close-review")
    expect(autoAdvance).toBe(true)
  })

  it("reviewModified + allChecked + real feedback → review-process, autoAdvance true", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: true,
        reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: true,
      }),
    ])
    expect(value).toBe("review-process")
    expect(autoAdvance).toBe(true)
  })

  it("ordering regression: unchecked-boxes wins over real feedback → review-incomplete", () => {
    const { value, autoAdvance } = resolve([
      resolveEvent({
        reviewModified: true,
        reviewHasUncheckedBoxes: true,
        reviewHasRealFeedback: true,
      }),
    ])
    expect(value).toBe("review-incomplete")
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

describe("no-agent action leaves — edgeAction + loop-back", () => {
  it("cleanup exposes removeGtdDir; next clearing RESOLVE advances + bumps noAgentHops", () => {
    const handle = start([resolveEvent({ gtdDirExists: true, hasPackages: false })])
    expect(handle.current.value).toBe("cleanup")
    expect(handle.current.edgeAction).toEqual({ kind: "removeGtdDir" })
    expect(handle.current.context.noAgentHops).toBe(0)
    // .gtd removed → now clean with a review base, settles human-review.
    const after = handle.advance([
      resolveEvent({
        gtdDirExists: false,
        reviewBasePresent: true,
        refDiff: "diff --git a/x b/x\n+hi\n",
        baseRef: "abc",
      }),
    ])
    expect(after.value).toBe("human-review")
    expect(after.edgeAction).toBeUndefined()
    expect(after.context.noAgentHops).toBe(1)
  })

  it("close-review exposes closeReview{base}; next RESOLVE advances + bumps noAgentHops", () => {
    const handle = start([
      resolveEvent({
        reviewModified: true,
        reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: false,
        baseRef: "base-sha",
      }),
    ])
    expect(handle.current.value).toBe("close-review")
    expect(handle.current.edgeAction).toEqual({ kind: "closeReview", base: "base-sha" })
    const after = handle.advance([resolveEvent({ reviewBasePresent: false })])
    expect(after.value).toBe("verified")
    expect(after.context.noAgentHops).toBe(1)
  })

  it("code-changes exposes commitPending; next clean RESOLVE advances + bumps noAgentHops", () => {
    const handle = start([resolveEvent({ codeDirty: true, reviewPresent: false })])
    expect(handle.current.value).toBe("code-changes")
    expect(handle.current.edgeAction).toEqual({ kind: "commitPending" })
    const after = handle.advance([resolveEvent({ codeDirty: false, reviewBasePresent: false })])
    expect(after.value).toBe("verified")
    expect(after.context.noAgentHops).toBe(1)
  })
})

describe("commit-pending — intent-disambiguated commit (Part B)", () => {
  it("dirty tree with NO intent → code-changes (Part A regression)", () => {
    const r = resolve([resolveEvent({ codeDirty: true, reviewPresent: false })])
    expect(r.value).toBe("code-changes")
    expect(r.edgeAction).toEqual({ kind: "commitPending" })
  })

  // Per-intent: a dirty-tree RESOLVE carrying that marker → commit-pending leaf
  // with the expected commitPending payload (machine-only; message/flags assert).
  const cases: Array<{
    readonly intent: PendingCommitIntent
    readonly expected: Record<string, unknown>
  }> = [
    {
      intent: "execute",
      expected: { kind: "commitPending", removeLastPackage: true, restorePaths: [] },
    },
    { intent: "decompose", expected: { kind: "commitPending", restorePaths: [] } },
    { intent: "human-review", expected: { kind: "commitPending", restorePaths: [] } },
    { intent: "execute-simple", expected: { kind: "commitPending", restorePaths: [] } },
    {
      intent: "new-todo",
      expected: { kind: "commitPending", message: "docs(plan): record TODO.md", restorePaths: [] },
    },
    {
      intent: "modified-todo",
      expected: { kind: "commitPending", message: "docs(plan): record TODO.md", restorePaths: [] },
    },
    { intent: "fix-tests", expected: { kind: "commitPending", restorePaths: ["TODO.md"] } },
  ]

  for (const { intent, expected } of cases) {
    it(`intent "${intent}" → commit-pending emitting ${JSON.stringify(expected)}`, () => {
      const r = resolve([resolveEvent({ codeDirty: true, pendingCommitIntent: intent })])
      expect(r.value).toBe("commit-pending")
      expect(r.edgeAction).toEqual(expected)
    })
  }

  it("intent routes to commit-pending AHEAD of code-changes even with codeDirty", () => {
    const r = resolve([resolveEvent({ codeDirty: true, pendingCommitIntent: "execute" })])
    expect(r.value).toBe("commit-pending")
  })

  it("commit-pending bumps noAgentHops; cleared intent on next RESOLVE advances", () => {
    const handle = start([resolveEvent({ codeDirty: true, pendingCommitIntent: "decompose" })])
    expect(handle.current.value).toBe("commit-pending")
    const after = handle.advance([resolveEvent({ codeDirty: false, reviewBasePresent: false })])
    expect(after.value).toBe("verified")
    expect(after.context.noAgentHops).toBe(1)
  })

  it("stuck: marker persists after the commit (tree never cleared) → escalate", () => {
    const handle = start([resolveEvent({ codeDirty: true, pendingCommitIntent: "execute" })])
    expect(handle.current.value).toBe("commit-pending")
    const after = handle.advance([
      resolveEvent({ codeDirty: true, pendingCommitIntent: "execute" }),
    ])
    expect(after.value).toBe("escalate")
  })

  it("noAgentHops cap bounds a commit that keeps making progress but never finishes", () => {
    // Alternate intent ↔ generic code-changes so each hop progresses (no stuck)
    // and the hop counter climbs to the cap → escalate.
    const intent = resolveEvent({ codeDirty: true, pendingCommitIntent: "decompose" })
    const code = resolveEvent({ codeDirty: true })
    const handle = start([intent])
    let last = handle.current
    for (let i = 0; i < MAX_NO_AGENT_HOPS; i++) {
      last = handle.advance([i % 2 === 0 ? code : intent])
      if (last.value === "escalate") break
    }
    expect(last.value).toBe("escalate")
  })
})

describe("no-agent loop — cap + stuck escalation", () => {
  it("noAgentHops >= MAX_NO_AGENT_HOPS → escalate", () => {
    // Alternate code-changes ↔ cleanup so each hop makes progress (no `stuck`)
    // and the hop counter climbs to the cap.
    const codeChanges = resolveEvent({ codeDirty: true })
    const cleanup = resolveEvent({ codeDirty: false, gtdDirExists: true })
    const handle = start([codeChanges])
    expect(handle.current.value).toBe("code-changes")
    let last = handle.current
    for (let i = 0; i < MAX_NO_AGENT_HOPS; i++) {
      last = handle.advance([i % 2 === 0 ? cleanup : codeChanges])
      if (last.value === "escalate") break
    }
    expect(last.value).toBe("escalate")
    expect(last.context.noAgentHops).toBeGreaterThanOrEqual(MAX_NO_AGENT_HOPS)
    expect(last.edgeAction).toBeUndefined()
  })

  it("stuck: re-settling on the same no-agent leaf with no progress → escalate", () => {
    // close-review → next RESOLVE still close-review (no progress) → escalate.
    const handle = start([
      resolveEvent({
        reviewModified: true,
        reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: false,
        baseRef: "b",
      }),
    ])
    expect(handle.current.value).toBe("close-review")
    const after = handle.advance([
      resolveEvent({
        reviewModified: true,
        reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: false,
        baseRef: "b",
      }),
    ])
    expect(after.value).toBe("escalate")
  })
})

describe("runTestGate — TEST_RESULT fold (moved from selectPrompt)", () => {
  const gate = () => start([resolveEvent({ hasPackages: true, gtdDirExists: true })])

  it("green → execute, no edgeAction", () => {
    const after = gate().advance([{ type: "TEST_RESULT", exitCode: 0, output: "" }])
    expect(after.value).toBe("execute")
    expect(after.edgeAction).toBeUndefined()
  })

  it("red below cap → fix-tests carrying testOutput", () => {
    const after = gate().advance([
      { type: "TEST_RESULT", exitCode: 1, output: "FAIL src/y.test.ts" },
    ])
    expect(after.value).toBe("fix-tests")
    expect(after.context.testOutput).toBe("FAIL src/y.test.ts")
    expect(after.edgeAction).toBeUndefined()
  })

  it("red just below cap (verify = max-1) → fix-tests, not escalate", () => {
    // capReached precedes hasPackages in the chain, so the gate is only ever
    // reached while verifyIterations < max; the gate's own red→fix-tests branch
    // owns this case. (The gate's red≥cap→escalate branch exists for fidelity
    // with the retired selectPrompt but is shadowed by replaying's capReached.)
    const handle = start([
      ...Array.from({ length: MAX_VERIFY_ITERATIONS - 1 }, () => commit(true)),
      resolveEvent({ hasPackages: true, gtdDirExists: true }),
    ])
    expect(handle.current.edgeAction).toEqual({ kind: "runTestGate" })
    const after = handle.advance([{ type: "TEST_RESULT", exitCode: 1, output: "boom" }])
    expect(after.value).toBe("fix-tests")
    expect(after.context.testOutput).toBe("boom")
  })

  it("red at cap (verify >= max) → escalate via the gate fold", () => {
    // hasPackages precedes capReached in the chain, so a capped verify count
    // STILL reaches the gate; the gate fold's red≥cap branch escalates (this is
    // exactly why the test gate had to move into the machine — see main.ts note).
    const events: Array<GtdEvent> = []
    for (let i = 0; i < MAX_VERIFY_ITERATIONS; i++) events.push(commit(true))
    events.push(resolveEvent({ hasPackages: true, gtdDirExists: true }))
    const handle = start(events)
    expect(handle.current.value).toBe("execute")
    expect(handle.current.edgeAction).toEqual({ kind: "runTestGate" })
    const after = handle.advance([{ type: "TEST_RESULT", exitCode: 1, output: "still failing" }])
    expect(after.value).toBe("escalate")
    expect(after.edgeAction).toBeUndefined()
  })

  it("human-review settles WITHOUT a runTestGate edgeAction", () => {
    const hr = start([
      resolveEvent({
        reviewBasePresent: true,
        refDiff: "diff --git a/x b/x\n+hi\n",
        baseRef: "abc",
      }),
    ])
    expect(hr.current.value).toBe("human-review")
    expect(hr.current.edgeAction).toBeUndefined()
  })
})

describe("review-process — reviewPreRender then REVIEW_RECORDED", () => {
  it("emits reviewPreRender{base}, then settles carrying reviewDiff/recordSha", () => {
    const handle = start([
      resolveEvent({
        reviewModified: true,
        reviewHasUncheckedBoxes: false,
        reviewHasRealFeedback: true,
        baseRef: "rev-base",
      }),
    ])
    expect(handle.current.value).toBe("review-process")
    expect(handle.current.edgeAction).toEqual({ kind: "reviewPreRender", base: "rev-base" })
    const after = handle.advance([
      { type: "REVIEW_RECORDED", diff: "DIFF-BODY", recordSha: "sha123" },
    ])
    expect(after.value).toBe("review-process")
    expect(after.edgeAction).toBeUndefined()
    expect(after.autoAdvance).toBe(true)
    expect(after.context.reviewDiff).toBe("DIFF-BODY")
    expect(after.context.recordSha).toBe("sha123")
  })
})
