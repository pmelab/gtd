import { describe, expect, it } from "vitest"
import {
  DEFAULT_PAYLOAD,
  type EdgeAction,
  type GtdEvent,
  type ResolvePayload,
  foldCounters,
  GtdStateError,
  resolve,
} from "./Machine.js"

// ── Builders (events constructed directly, like the old basePayload/commit) ──

const commit = (
  flags: {
    isErrors?: boolean
    isFeedback?: boolean
    isPackageStart?: boolean
    isWorkflowCommit?: boolean
    removedErrors?: boolean
  } = {},
): GtdEvent => ({
  type: "COMMIT",
  isErrors: flags.isErrors ?? false,
  isFeedback: flags.isFeedback ?? false,
  isPackageStart: flags.isPackageStart ?? false,
  isWorkflowCommit: flags.isWorkflowCommit ?? true,
  removedErrors: flags.removedErrors ?? false,
})

const basePayload = (overrides: Partial<ResolvePayload> = {}): ResolvePayload => ({
  ...DEFAULT_PAYLOAD,
  lastCommitSubject: "chore: init",
  ...overrides,
})

const R = (overrides: Partial<ResolvePayload> = {}): GtdEvent => ({
  type: "RESOLVE",
  payload: basePayload(overrides),
})

// ── Counter folds ────────────────────────────────────────────────────────────

describe("foldCounters — testFixCount", () => {
  it("empty stream → 0", () => {
    expect(foldCounters([]).testFixCount).toBe(0)
    expect(resolve([]).context.testFixCount).toBe(0)
  })

  it("N trailing isErrors → N", () => {
    const events = [
      commit({ isErrors: true }),
      commit({ isErrors: true }),
      commit({ isErrors: true }),
    ]
    expect(foldCounters(events).testFixCount).toBe(3)
  })

  it("walks through non-error workflow commits without resetting", () => {
    // gtd: errors, gtd: fixing (walk-through), gtd: errors → 2
    const events = [commit({ isErrors: true }), commit(), commit({ isErrors: true })]
    expect(foldCounters(events).testFixCount).toBe(2)
  })

  it("resets on isPackageStart", () => {
    const events = [
      commit({ isErrors: true }),
      commit({ isPackageStart: true }),
      commit({ isErrors: true }),
    ]
    expect(foldCounters(events).testFixCount).toBe(1)
  })

  it("resets on isFeedback", () => {
    const events = [
      commit({ isErrors: true }),
      commit({ isFeedback: true }),
      commit({ isErrors: true }),
    ]
    expect(foldCounters(events).testFixCount).toBe(1)
  })

  it("resets on removedErrors (human resume) commit", () => {
    const events = [
      commit({ isErrors: true }),
      commit({ isErrors: true }),
      commit({ removedErrors: true }), // gtd: building that deleted ERRORS.md
      commit({ isErrors: true }),
    ]
    expect(foldCounters(events).testFixCount).toBe(1)
  })
})

describe("foldCounters — reviewFixCount", () => {
  it("counts isFeedback since the most recent isPackageStart", () => {
    const events = [
      commit({ isPackageStart: true }),
      commit({ isFeedback: true }),
      commit({ isFeedback: true }),
    ]
    expect(foldCounters(events).reviewFixCount).toBe(2)
  })

  it("resets on a later isPackageStart", () => {
    const events = [
      commit({ isFeedback: true }),
      commit({ isPackageStart: true }),
      commit({ isFeedback: true }),
    ]
    expect(foldCounters(events).reviewFixCount).toBe(1)
  })

  it("is independent of testFixCount (errors don't touch it)", () => {
    const events = [
      commit({ isFeedback: true }),
      commit({ isErrors: true }),
      commit({ isErrors: true }),
    ]
    const { reviewFixCount, testFixCount } = foldCounters(events)
    expect(reviewFixCount).toBe(1)
    expect(testFixCount).toBe(2)
  })
})

// ── Illegal-combination hard-errors ──────────────────────────────────────────

describe("illegal-combination hard-errors (throw before the ladder)", () => {
  const cases: Array<[string, Partial<ResolvePayload>]> = [
    ["REVIEW + .gtd", { reviewPresent: true, gtdDirExists: true }],
    ["REVIEW + committed TODO", { reviewPresent: true, todoExists: true, todoCommitted: true }],
    ["uncommitted REVIEW + TODO", { reviewPresent: true, todoExists: true }],
    ["FEEDBACK + REVIEW", { feedbackPresent: true, reviewPresent: true }],
    ["FEEDBACK without .gtd", { feedbackPresent: true, gtdDirExists: false }],
    ["ERRORS + FEEDBACK", { errorsPresent: true, feedbackPresent: true, gtdDirExists: true }],
    ["ERRORS without .gtd", { errorsPresent: true, gtdDirExists: false }],
  ]
  for (const [name, payload] of cases) {
    it(`throws on ${name}`, () => {
      expect(() => resolve([R(payload)])).toThrow(GtdStateError)
      try {
        resolve([R(payload)])
      } catch (e) {
        expect((e as GtdStateError).kind).toBe("illegal-combination")
      }
    })
  }

  it("committed REVIEW + uncommitted TODO is legal — review feedback (Accept Review)", () => {
    const res = resolve([
      R({
        reviewPresent: true,
        reviewDirty: true,
        workingTreeClean: false,
        todoExists: true,
        todoCommitted: false,
        lastCommitSubject: "gtd: awaiting review",
      }),
    ])
    expect(res.state).toBe("accept-review")
    expect(res.edgeAction).toEqual({ kind: "seedAcceptReview" })
  })
})

// ── Corruption hard-error ────────────────────────────────────────────────────

describe("corruption hard-error (no rule matched)", () => {
  it(".gtd present + clean + unrecognized HEAD → corruption", () => {
    expect(() => resolve([R({ gtdDirExists: true, lastCommitSubject: "gtd: grilled" })])).toThrow(
      GtdStateError,
    )
    try {
      resolve([R({ gtdDirExists: true, lastCommitSubject: "gtd: grilled" })])
    } catch (e) {
      expect((e as GtdStateError).kind).toBe("corruption")
    }
  })

  it("dirty tree + mid-phase HEAD + no steering → corruption", () => {
    expect(() =>
      resolve([
        R({ codeDirty: true, workingTreeClean: false, lastCommitSubject: "gtd: package done" }),
      ]),
    ).toThrow(GtdStateError)
  })

  it("clean tree + mid-phase non-boundary HEAD + no steering → corruption", () => {
    expect(() => resolve([R({ lastCommitSubject: "gtd: building" })])).toThrow(GtdStateError)
  })
})

// ── The 16 states ────────────────────────────────────────────────────────────

const r = (overrides: Partial<ResolvePayload> = {}): ReturnType<typeof resolve> =>
  resolve([R(overrides)])

describe("rule 0 — Transport", () => {
  it("HEAD gtd: transport → transport, auto, transportReset", () => {
    const res = r({ lastCommitSubject: "gtd: transport" })
    expect(res.state).toBe("transport")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({ kind: "transportReset" } satisfies EdgeAction)
  })

  it("transport wins even with dirty tree", () => {
    expect(
      r({ lastCommitSubject: "gtd: transport", codeDirty: true, workingTreeClean: false }).state,
    ).toBe("transport")
  })
})

describe("rule 1 — Escalate", () => {
  it("errorsPresent → escalate, STOP, no edgeAction", () => {
    const res = r({ errorsPresent: true, gtdDirExists: true })
    expect(res.state).toBe("escalate")
    expect(res.autoAdvance).toBe(false)
    expect(res.edgeAction).toBeUndefined()
  })
})

describe("rule 2 — Fixing / Close package", () => {
  it("empty FEEDBACK → close-package, auto, closePackage", () => {
    const res = r({ feedbackPresent: true, feedbackEmpty: true, gtdDirExists: true })
    expect(res.state).toBe("close-package")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({ kind: "closePackage" } satisfies EdgeAction)
  })

  it("uncommitted (agentic) FEEDBACK → fixing, commitPending gtd: feedback (removeFeedback)", () => {
    const res = r({ feedbackPresent: true, feedbackCommitted: false, gtdDirExists: true })
    expect(res.state).toBe("fixing")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({
      kind: "commitPending",
      prefix: "gtd: feedback",
      removeFeedback: true,
    })
  })

  it("committed (testing) FEEDBACK → fixing, commitPending gtd: fixing (removeFeedback)", () => {
    const res = r({ feedbackPresent: true, feedbackCommitted: true, gtdDirExists: true })
    expect(res.state).toBe("fixing")
    expect(res.edgeAction).toEqual({
      kind: "commitPending",
      prefix: "gtd: fixing",
      removeFeedback: true,
    })
  })
})

describe("rule 3 — build lifecycle", () => {
  it("gtdModified → planning, commitPending gtd: planning", () => {
    const res = r({ gtdDirExists: true, gtdModified: true, workingTreeClean: false })
    expect(res.state).toBe("planning")
    expect(res.edgeAction).toEqual({ kind: "commitPending", prefix: "gtd: planning" })
  })

  it("codeDirty → testing, runTest with folded budget", () => {
    const res = resolve([
      commit({ isErrors: true }),
      commit({ isErrors: true }),
      R({ gtdDirExists: true, codeDirty: true, workingTreeClean: false }),
    ])
    expect(res.state).toBe("testing")
    expect(res.edgeAction).toEqual({ kind: "runTest", errorCount: 2, capReached: false })
  })

  it("testing capReached when testFixCount >= fixAttemptCap", () => {
    const res = resolve([
      commit({ isErrors: true }),
      commit({ isErrors: true }),
      commit({ isErrors: true }),
      R({ gtdDirExists: true, codeDirty: true, workingTreeClean: false }),
    ])
    expect(res.edgeAction).toEqual({ kind: "runTest", errorCount: 3, capReached: true })
  })

  it("no-op fixer (clean + HEAD gtd: fixing) → testing", () => {
    const res = r({ gtdDirExists: true, lastCommitSubject: "gtd: fixing" })
    expect(res.state).toBe("testing")
    expect(res.edgeAction).toEqual({ kind: "runTest", errorCount: 0, capReached: false })
  })

  it("pendingErrorsDeletion (human resume) → testing with a fresh budget (errorCount 0)", () => {
    // Even with a capped history, resume grants a fresh budget.
    const res = resolve([
      commit({ isErrors: true }),
      commit({ isErrors: true }),
      commit({ isErrors: true }),
      R({ gtdDirExists: true, pendingErrorsDeletion: true, workingTreeClean: false }),
    ])
    expect(res.state).toBe("testing")
    expect(res.edgeAction).toEqual({ kind: "runTest", errorCount: 0, capReached: false })
  })

  it("clean + HEAD gtd: planning + todoExists → building, commitPending with removeTodo", () => {
    const res = r({ gtdDirExists: true, lastCommitSubject: "gtd: planning", todoExists: true })
    expect(res.state).toBe("building")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({
      kind: "commitPending",
      prefix: "gtd: planning",
      removeTodo: true,
    } satisfies EdgeAction)
  })

  it("clean + HEAD gtd: planning + !todoExists → building, no edgeAction", () => {
    const res = r({ gtdDirExists: true, lastCommitSubject: "gtd: planning", todoExists: false })
    expect(res.state).toBe("building")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toBeUndefined()
  })

  it("clean + HEAD gtd: package done → building, no edgeAction", () => {
    const res = r({ gtdDirExists: true, lastCommitSubject: "gtd: package done" })
    expect(res.state).toBe("building")
    expect(res.edgeAction).toBeUndefined()
  })

  it("clean + HEAD gtd: building → agentic-review, no edgeAction", () => {
    const res = r({ gtdDirExists: true, lastCommitSubject: "gtd: building" })
    expect(res.state).toBe("agentic-review")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toBeUndefined()
  })

  it("force-approve when agenticReview disabled → close-package", () => {
    const res = r({
      gtdDirExists: true,
      lastCommitSubject: "gtd: building",
      agenticReviewEnabled: false,
    })
    expect(res.state).toBe("close-package")
    expect(res.edgeAction).toEqual({ kind: "closePackage" })
  })

  it("force-approve when reviewFixCount >= reviewThreshold → close-package", () => {
    const res = resolve([
      commit({ isPackageStart: true }),
      commit({ isFeedback: true }),
      commit({ isFeedback: true }),
      commit({ isFeedback: true }),
      R({ gtdDirExists: true, lastCommitSubject: "gtd: building", agenticReviewEnabled: true }),
    ])
    expect(res.state).toBe("close-package")
  })

  it("below threshold + enabled → still agentic-review (never skipped)", () => {
    const res = resolve([
      commit({ isPackageStart: true }),
      commit({ isFeedback: true }),
      commit({ isFeedback: true }),
      R({ gtdDirExists: true, lastCommitSubject: "gtd: building", agenticReviewEnabled: true }),
    ])
    expect(res.state).toBe("agentic-review")
  })
})

describe("rule 4 — review lifecycle", () => {
  it("uncommitted REVIEW → await-review, STOP, commitReview", () => {
    const res = r({ reviewPresent: true, reviewCommitted: false, reviewDirty: false })
    expect(res.state).toBe("await-review")
    expect(res.autoAdvance).toBe(false)
    expect(res.edgeAction).toEqual({ kind: "commitReview" })
  })

  it("committed + clean REVIEW → done, auto, done", () => {
    const res = r({ reviewPresent: true, reviewCommitted: true })
    expect(res.state).toBe("done")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({ kind: "done" })
  })

  it("committed + dirty REVIEW → accept-review, auto, seedAcceptReview", () => {
    const res = r({ reviewPresent: true, reviewCommitted: false, reviewDirty: true })
    expect(res.state).toBe("accept-review")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({ kind: "seedAcceptReview" })
    // The feedback path never commits `gtd: done` in the same resolve: the one
    // returned edgeAction is the seed, and the two done branches are unreachable
    // (`reviewCommitted` needs a clean tree, checkbox-only is excluded here).
  })

  it("reviewDirty + reviewCheckboxOnly → done, auto, done", () => {
    const res = r({
      reviewPresent: true,
      reviewCommitted: false,
      reviewDirty: true,
      reviewCheckboxOnly: true,
    })
    expect(res.state).toBe("done")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({ kind: "done" })
  })

  // Regen carve-out: HEAD is the accept-review capture commit and REVIEW.md is
  // present again (its annotated copy is IN that commit) — the uncommitted seed
  // was lost. Routing to Done here would silently approve the annotations.
  it("REVIEW present + HEAD gtd: review feedback + clean → accept-review regen, never done", () => {
    const res = r({
      reviewPresent: true,
      reviewCommitted: true,
      lastCommitSubject: "gtd: review feedback",
    })
    expect(res.state).toBe("accept-review")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({ kind: "seedAcceptReview" })
  })

  it("REVIEW present + HEAD gtd: review feedback + dirty (partial revert) → accept-review regen", () => {
    const res = r({
      reviewPresent: true,
      reviewDirty: true,
      workingTreeClean: false,
      lastCommitSubject: "gtd: review feedback",
    })
    expect(res.state).toBe("accept-review")
    expect(res.edgeAction).toEqual({ kind: "seedAcceptReview" })
  })
})

describe("rule 5 — New Feature", () => {
  it("boundary HEAD + dirty (code changes) → new-feature, seedNewFeature", () => {
    const res = r({ lastCommitSubject: "feat: x", codeDirty: true, workingTreeClean: false })
    expect(res.state).toBe("new-feature")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toEqual({ kind: "seedNewFeature" })
  })

  it("boundary HEAD + new uncommitted TODO.md → new-feature", () => {
    const res = r({
      lastCommitSubject: "gtd: done",
      todoExists: true,
      workingTreeClean: false,
    })
    expect(res.state).toBe("new-feature")
  })

  it("HEAD gtd: new task + clean tree (lost seed) → new-feature (regenerate)", () => {
    const res = r({ lastCommitSubject: "gtd: new task", workingTreeClean: true })
    expect(res.state).toBe("new-feature")
  })

  it("HEAD gtd: new task + dirty tree → grilling (commit the seed), not new-feature", () => {
    const res = r({ lastCommitSubject: "gtd: new task", todoExists: true, workingTreeClean: false })
    expect(res.state).toBe("grilling")
  })

  // A committed TODO.md under a boundary HEAD is a resumed grill — even with a
  // dirty tree it must route to Grilling (which captures the code edits), not
  // re-seed and clobber the developed plan (STATES.md § New Feature).
  it("boundary HEAD + dirty + committed TODO → grilling (resumed grill), not new-feature", () => {
    const res = r({
      lastCommitSubject: "feat: unrelated",
      workingTreeClean: false,
      codeDirty: true,
      todoExists: true,
      todoCommitted: true,
    })
    expect(res.state).toBe("grilling")
    expect(res.edgeAction).toEqual({ kind: "captureGrillingEdits" })
  })
})

describe("rule 6 — Grilling / Grilled (3-way)", () => {
  it("marker present → grilling STOP, grillingCase stop", () => {
    const res = r({ todoExists: true, todoMarkerPresent: true })
    expect(res.state).toBe("grilling")
    expect(res.autoAdvance).toBe(false)
    expect(res.context.grillingCase).toBe("stop")
    expect(res.edgeAction).toEqual({ kind: "commitPending", prefix: "gtd: grilling" })
  })

  it("no marker + pending (mid-grill HEAD) → grilling iterate, auto", () => {
    const res = r({
      todoExists: true,
      todoMarkerPresent: false,
      workingTreeClean: false,
      lastCommitSubject: "gtd: grilling",
    })
    expect(res.state).toBe("grilling")
    expect(res.autoAdvance).toBe(true)
    expect(res.context.grillingCase).toBe("iterate")
    expect(res.edgeAction).toEqual({ kind: "commitPending", prefix: "gtd: grilling" })
  })

  it("no marker + clean → grilled, auto, commitPending gtd: grilled", () => {
    const res = r({
      todoExists: true,
      todoMarkerPresent: false,
      workingTreeClean: true,
      lastCommitSubject: "gtd: grilling",
    })
    expect(res.state).toBe("grilled")
    expect(res.autoAdvance).toBe(true)
    expect(res.context.grillingCase).toBeUndefined()
    expect(res.edgeAction).toEqual({ kind: "commitPending", prefix: "gtd: grilled" })
  })

  // Later grilling rounds (committed plan) with pending code changes capture
  // the code into TODO.md as a suggestion block instead of committing it
  // verbatim — on BOTH the iterate and STOP paths.
  it("committed TODO + code changes (iterate) → captureGrillingEdits", () => {
    const res = r({
      todoExists: true,
      todoCommitted: true,
      codeDirty: true,
      workingTreeClean: false,
      lastCommitSubject: "gtd: grilling",
    })
    expect(res.state).toBe("grilling")
    expect(res.autoAdvance).toBe(true)
    expect(res.context.grillingCase).toBe("iterate")
    expect(res.edgeAction).toEqual({ kind: "captureGrillingEdits" })
  })

  it("committed TODO + code changes + open marker (STOP) → captureGrillingEdits, still stops", () => {
    const res = r({
      todoExists: true,
      todoCommitted: true,
      todoMarkerPresent: true,
      codeDirty: true,
      workingTreeClean: false,
      lastCommitSubject: "gtd: grilling",
    })
    expect(res.state).toBe("grilling")
    expect(res.autoAdvance).toBe(false)
    expect(res.context.grillingCase).toBe("stop")
    expect(res.edgeAction).toEqual({ kind: "captureGrillingEdits" })
  })

  it("committed TODO + only TODO edits pending → plain commitPending (no capture)", () => {
    const res = r({
      todoExists: true,
      todoCommitted: true,
      codeDirty: false,
      workingTreeClean: false,
      lastCommitSubject: "gtd: grilling",
    })
    expect(res.state).toBe("grilling")
    expect(res.edgeAction).toEqual({ kind: "commitPending", prefix: "gtd: grilling" })
  })

  it("uncommitted TODO (seed round) + code dirty → plain commitPending (the seed revert)", () => {
    const res = r({
      todoExists: true,
      todoCommitted: false,
      codeDirty: true,
      workingTreeClean: false,
      lastCommitSubject: "gtd: review feedback",
    })
    expect(res.state).toBe("grilling")
    expect(res.edgeAction).toEqual({ kind: "commitPending", prefix: "gtd: grilling" })
  })
})

describe("rule 7 — Clean / Idle", () => {
  it("boundary HEAD + clean + reviewable diff → clean, STOP, no edgeAction", () => {
    const res = r({
      lastCommitSubject: "feat: shipped",
      reviewBase: "abc123",
      refDiff: "diff --git a/x b/x\n+hello\n",
    })
    expect(res.state).toBe("clean")
    expect(res.autoAdvance).toBe(false)
    expect(res.edgeAction).toBeUndefined()
    expect(res.context.reviewBase).toBe("abc123")
  })

  it("gtd: package done HEAD + clean + reviewable → clean (finished feature)", () => {
    const res = r({
      lastCommitSubject: "gtd: package done",
      reviewBase: "abc",
      refDiff: "diff --git a/x b/x\n+y\n",
    })
    expect(res.state).toBe("clean")
  })

  it("HEAD gtd: done + clean + empty diff → idle, no edgeAction", () => {
    const res = r({ lastCommitSubject: "gtd: done" })
    expect(res.state).toBe("idle")
    expect(res.autoAdvance).toBe(false)
    expect(res.edgeAction).toBeUndefined()
  })

  it("reviewBase present but whitespace-only refDiff → idle (nothing to review)", () => {
    const res = r({ lastCommitSubject: "feat: x", reviewBase: "abc", refDiff: "  \n " })
    expect(res.state).toBe("idle")
  })

  // The loop fix: after an approved review (`gtd: done` with nothing after it)
  // the whole-branch diff is still non-empty, but the closed re-trigger gate
  // keeps the machine Idle instead of re-entering Clean.
  it("reviewable diff but closed re-trigger gate → idle (no review re-fire after done)", () => {
    const res = r({
      lastCommitSubject: "gtd: done",
      reviewBase: "abc123",
      refDiff: "diff --git a/x b/x\n+hello\n",
      hasCommitsAfterLastDone: false,
    })
    expect(res.state).toBe("idle")
    expect(res.autoAdvance).toBe(false)
    expect(res.edgeAction).toBeUndefined()
  })

  it("open gate + reviewable diff after new commits land → clean (review re-fires)", () => {
    const res = r({
      lastCommitSubject: "feat: post-done work",
      reviewBase: "abc123",
      refDiff: "diff --git a/x b/x\n+hello\n",
      hasCommitsAfterLastDone: true,
    })
    expect(res.state).toBe("clean")
  })

  it("resolve([]) → idle (degenerate input, no throw)", () => {
    expect(resolve([]).state).toBe("idle")
  })
})

describe("rule 7 — Squashing", () => {
  it("HEAD gtd: done + squashEnabled + squashBase set → squashing, auto, no edgeAction", () => {
    const res = r({
      lastCommitSubject: "gtd: done",
      squashEnabled: true,
      squashBase: "abc123",
    })
    expect(res.state).toBe("squashing")
    expect(res.autoAdvance).toBe(true)
    expect(res.edgeAction).toBeUndefined()
  })

  it("HEAD gtd: done + squashEnabled + squashBase set → context carries squashBase/squashDiff", () => {
    const res = r({
      lastCommitSubject: "gtd: done",
      squashEnabled: true,
      squashBase: "abc123",
      squashDiff: "diff --git a/x b/x\n+hello\n",
    })
    expect(res.context.squashBase).toBe("abc123")
    expect(res.context.squashDiff).toBe("diff --git a/x b/x\n+hello\n")
  })

  it("HEAD gtd: done + squashEnabled + squashBase unset → idle (nothing to squash)", () => {
    const res = r({
      lastCommitSubject: "gtd: done",
      squashEnabled: true,
    })
    expect(res.state).toBe("idle")
  })

  it("HEAD gtd: done + squashEnabled: false + squashBase set → idle (config opt-out)", () => {
    const res = r({
      lastCommitSubject: "gtd: done",
      squashEnabled: false,
      squashBase: "abc123",
    })
    expect(res.state).toBe("idle")
  })

  it("HEAD gtd: done with no squash fields (DEFAULT_PAYLOAD) → idle (default behavior)", () => {
    const res = r({ lastCommitSubject: "gtd: done" })
    expect(res.state).toBe("idle")
  })
})

// ── Context passthrough ──────────────────────────────────────────────────────

describe("context passthrough + folds", () => {
  it("carries packages, diff, refDiff, reviewBase, lastCommitSubject, workingTreeClean", () => {
    const { context } = resolve([
      commit({ isErrors: true }),
      R({
        lastCommitSubject: "feat: thing",
        workingTreeClean: false,
        codeDirty: true,
        gtdDirExists: true,
        diff: "DIFF",
        packages: [
          {
            name: "01-foo",
            tasks: ["01-task.md"],
            taskContents: [{ name: "01-task.md", content: "body" }],
          },
        ],
      }),
    ])
    expect(context.testFixCount).toBe(1)
    expect(context.reviewFixCount).toBe(0)
    expect(context.diff).toBe("DIFF")
    expect(context.lastCommitSubject).toBe("feat: thing")
    expect(context.workingTreeClean).toBe(false)
    expect(context.packages[0]!.taskContents).toEqual([{ name: "01-task.md", content: "body" }])
  })
})
