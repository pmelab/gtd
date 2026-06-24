import { assign, createActor, setup } from "xstate"

/**
 * Pure, event-sourced state machine used as a FOLD over a stream of git facts.
 *
 * This module is intentionally free of any IO: no git, no filesystem, no
 * Effect. Edge code parses the working tree / commit history into the events
 * below, and `resolve` folds them into a single terminal leaf state plus the
 * context the prompt layer needs. Keeping it pure makes the decision tree
 * trivially unit-testable in isolation.
 */

/** Hardcoded cap on consecutive `fix(gtd):` verify iterations before escalating. */
export const MAX_VERIFY_ITERATIONS = 3

/**
 * Hardcoded cap on consecutive no-agent action hops (cleanup / close-review /
 * code-changes loop-backs) before escalating. Orthogonal to
 * `MAX_VERIFY_ITERATIONS` — a separate counter that never mixes with the verify
 * loop.
 */
export const MAX_NO_AGENT_HOPS = 8

export interface GtdPackageFact {
  readonly name: string
  /** Task .md filenames, sorted (UNCHANGED — still drives the Context listing). */
  readonly tasks: ReadonlyArray<string>
  /** Full contents of each task .md file, parallel-sorted to `tasks`. */
  readonly taskContents: ReadonlyArray<{ readonly name: string; readonly content: string }>
  /** Whether the package dir contains a COMMIT_MSG.md. */
  readonly hasCommitMsg: boolean
}

/**
 * Terminal working-tree facts the RESOLVE guards branch on, plus passthrough
 * fields that flow straight onto the resulting leaf context.
 */
export interface ResolvePayload {
  /** A committed `ERRORS.md` is present — the test loop escalated to the human. */
  readonly errorsPresent: boolean
  /** Working-tree REVIEW.md has at least one unchecked `- [ ] ` line. */
  readonly reviewHasUncheckedBoxes: boolean
  /** Working-tree delta beyond forward checkbox ticks (non-tick REVIEW.md edits, dirty source, untracked). */
  readonly reviewHasRealFeedback: boolean
  /** REVIEW.md exists with user edits. */
  readonly reviewModified: boolean
  /** REVIEW.md exists and is committed/unmodified — the review gate. */
  readonly reviewUnmodified: boolean
  /** Any uncommitted change outside TODO.md AND REVIEW.md is present. */
  readonly codeDirty: boolean
  /** `.gtd/` contains work packages to execute. */
  readonly hasPackages: boolean
  /** `.gtd/` exists (possibly empty). */
  readonly gtdDirExists: boolean
  /** Uncommitted state of TODO.md, if any. */
  readonly todoDirty: "new" | "modified" | null
  /** TODO.md exists at all. */
  readonly todoExists: boolean
  /** TODO.md `status:` frontmatter value (folds legacy `<!-- simple -->`). */
  readonly todoStatus: "simple" | "complete" | "grilling" | null
  /** TODO.md has unanswered questions under `## Open Questions`. */
  readonly todoOpenQuestionsPresent: boolean
  /** A review base ref is available to diff against. */
  readonly reviewBasePresent: boolean
  /** A REVIEW.md is present (committed and/or dirty) — the review path owns routing. */
  readonly reviewPresent: boolean
  // passthrough
  readonly lastCommitSubject: string
  readonly workingTreeClean: boolean
  readonly packages: ReadonlyArray<GtdPackageFact>
  readonly diff: string
  readonly baseRef?: string
  readonly refDiff?: string
}

export type GtdEvent =
  | { type: "COMMIT"; isTestFix: boolean }
  | { type: "RESOLVE"; payload: ResolvePayload }
  | { type: "TEST_RESULT"; exitCode: number; output: string }
  | { type: "REVIEW_RECORDED"; diff: string; recordSha: string }

export type EdgeAction =
  | { kind: "removeGtdDir" }
  | { kind: "closeReview"; base: string }
  | { kind: "commitPending" }
  | { kind: "runTestGate" }
  | { kind: "reviewPreRender"; base: string }

export interface GtdContext {
  verifyIterations: number
  maxVerifyIterations: number
  /** Consecutive no-agent action hops; independent of `verifyIterations`. */
  noAgentHops: number
  /** The no-agent leaf settled on the previous hop, for the `stuck` guard. */
  lastAdvancedLeaf: LeafState | null
  lastCommitSubject: string
  workingTreeClean: boolean
  packages: ReadonlyArray<GtdPackageFact>
  diff: string
  baseRef?: string
  refDiff?: string
  /** Captured red-test output for the `fix-tests` render. */
  testOutput?: string
  /** REVIEW_RECORDED synthesis diff for the review-process render. */
  reviewDiff?: string
  /** REVIEW_RECORDED recovery sha for the review-process render. */
  recordSha?: string
  /** The action a settled action-leaf wants the edge to perform; else cleared. */
  edgeAction?: EdgeAction
}

/** Terminal leaf-state ids. These are the only non-`replaying` states. */
export type LeafState =
  | "close-review"
  | "review-process"
  | "review-incomplete"
  | "await-review"
  | "code-changes"
  | "execute"
  | "cleanup"
  | "decompose"
  | "execute-simple"
  | "escalate"
  | "new-todo"
  | "modified-todo"
  | "await-answers"
  | "human-review"
  | "verified"
  | "fix-tests"

const initialContext: GtdContext = {
  verifyIterations: 0,
  maxVerifyIterations: MAX_VERIFY_ITERATIONS,
  noAgentHops: 0,
  lastAdvancedLeaf: null,
  lastCommitSubject: "",
  workingTreeClean: true,
  packages: [],
  diff: "",
}

/**
 * The ordered RESOLVE guard chain, shared by `replaying` and by each no-agent
 * action leaf's loop-back. `actions` are run on every matching branch (e.g.
 * `["applyPayload"]` from `replaying`, `["foldAdvance", "applyPayload"]` on a
 * loop-back so the hop counter bumps). When `stuckLeaf` is set (a loop-back from
 * that action leaf), a `stuck` escalation is injected before the branch that
 * would re-settle on the same leaf — no progress between two consecutive hops.
 */
const resolveChain = (actions: ReadonlyArray<string>, stuckLeaf?: LeafState) => {
  const p = ({ event }: { event: GtdEvent }) =>
    event.type === "RESOLVE" ? event.payload : ({} as ResolvePayload)
  const chain: Array<unknown> = [
    { guard: { type: "errorsPresent", params: p }, target: "escalate", actions },
    ...(stuckLeaf === "code-changes"
      ? [{ guard: { type: "stuckCodeChanges", params: p }, target: "escalate", actions }]
      : []),
    { guard: { type: "codeDirty", params: p }, target: "code-changes", actions },
    { guard: { type: "reviewUnmodified", params: p }, target: "await-review", actions },
    { guard: { type: "reviewIncomplete", params: p }, target: "review-incomplete", actions },
    ...(stuckLeaf === "close-review"
      ? [{ guard: { type: "stuckCloseReview", params: p }, target: "escalate", actions }]
      : []),
    { guard: { type: "closeReview", params: p }, target: "close-review", actions },
    { guard: { type: "reviewModified", params: p }, target: "review-process", actions },
    { guard: { type: "hasPackages", params: p }, target: "runTestGate", actions },
    ...(stuckLeaf === "cleanup"
      ? [{ guard: { type: "stuckCleanup", params: p }, target: "escalate", actions }]
      : []),
    { guard: { type: "gtdDirExists", params: p }, target: "cleanup", actions },
    { guard: { type: "todoSimple", params: p }, target: "execute-simple", actions },
    { guard: { type: "todoComplete", params: p }, target: "decompose", actions },
    { guard: "capReached", target: "escalate", actions },
    { guard: { type: "todoAwaitAnswers", params: p }, target: "await-answers", actions },
    { guard: { type: "todoRegrill", params: p }, target: "modified-todo", actions },
    { guard: { type: "todoInitial", params: p }, target: "new-todo", actions },
    { guard: { type: "humanReview", params: p }, target: "human-review", actions },
    { target: "verified", actions },
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return chain as any
}

const machine = setup({
  types: {
    context: {} as GtdContext,
    events: {} as GtdEvent,
  },
  guards: {
    errorsPresent: (_, params: ResolvePayload) => params.errorsPresent,
    // All boxes checked + no real feedback — safe to close the review.
    closeReview: (_, params: ResolvePayload) =>
      params.reviewModified && !params.reviewHasUncheckedBoxes && !params.reviewHasRealFeedback,
    // REVIEW.md was modified but still has unchecked boxes — human must finish.
    reviewIncomplete: (_, params: ResolvePayload) =>
      params.reviewModified && params.reviewHasUncheckedBoxes,
    reviewModified: (_, params: ResolvePayload) => params.reviewModified,
    reviewUnmodified: (_, params: ResolvePayload) => params.reviewUnmodified,
    codeDirty: (_, params: ResolvePayload) => params.codeDirty && !params.reviewPresent,
    hasPackages: (_, params: ResolvePayload) => params.hasPackages,
    gtdDirExists: (_, params: ResolvePayload) => params.gtdDirExists,
    todoSimple: (_, params: ResolvePayload) => params.todoStatus === "simple",
    todoComplete: (_, params: ResolvePayload) => params.todoStatus === "complete",
    capReached: ({ context }) => context.verifyIterations >= context.maxVerifyIterations,
    // Grilled plan, committed, with open questions still pending → human gate.
    todoAwaitAnswers: (_, params: ResolvePayload) =>
      params.todoStatus === "grilling" &&
      params.todoDirty === null &&
      params.todoOpenQuestionsPresent,
    // Re-grill: a grilling plan the user edited, or a markerless plan modified
    // in place.
    todoRegrill: (_, params: ResolvePayload) =>
      (params.todoStatus === "grilling" &&
        (params.todoDirty !== null || !params.todoOpenQuestionsPresent)) ||
      (params.todoStatus === null && params.todoDirty === "modified"),
    // First grill: a markerless plan (fresh sketch), committed or newly added.
    todoInitial: (_, params: ResolvePayload) =>
      params.todoExists && params.todoStatus === null && params.todoDirty !== "modified",
    humanReview: (_, params: ResolvePayload) =>
      params.reviewBasePresent && (params.refDiff ?? "").trim().length > 0,
    // No-agent action loop escalation guards (checked on re-entering an action
    // leaf). Cap is independent of the verify loop.
    noAgentCapReached: ({ context }) => context.noAgentHops >= MAX_NO_AGENT_HOPS,
    // `stuck`: the chain would re-settle on the SAME no-agent leaf we just left
    // (its settle condition still holds), i.e. no progress between two hops.
    stuckCleanup: ({ context }, params: ResolvePayload) =>
      context.lastAdvancedLeaf === "cleanup" && params.gtdDirExists,
    stuckCloseReview: ({ context }, params: ResolvePayload) =>
      context.lastAdvancedLeaf === "close-review" &&
      params.reviewModified &&
      !params.reviewHasUncheckedBoxes &&
      !params.reviewHasRealFeedback,
    stuckCodeChanges: ({ context }, params: ResolvePayload) =>
      context.lastAdvancedLeaf === "code-changes" && params.codeDirty && !params.reviewPresent,
    // Test-gate fold (mirrors the retired `selectPrompt`).
    testGreen: ({ event }) => event.type === "TEST_RESULT" && event.exitCode === 0,
    testRedBelowCap: ({ context, event }) =>
      event.type === "TEST_RESULT" &&
      event.exitCode !== 0 &&
      context.verifyIterations < context.maxVerifyIterations,
    testRedAtCap: ({ context, event }) =>
      event.type === "TEST_RESULT" &&
      event.exitCode !== 0 &&
      context.verifyIterations >= context.maxVerifyIterations,
  },
  actions: {
    foldCommit: assign({
      verifyIterations: ({ context, event }) => {
        if (event.type !== "COMMIT") return context.verifyIterations
        return event.isTestFix ? context.verifyIterations + 1 : 0
      },
    }),
    // Mirror of `foldCommit` for the no-agent loop: bump the hop counter and
    // record which action leaf we just left, so the next settle can detect lack
    // of progress (`stuck`).
    foldAdvance: assign({
      noAgentHops: ({ context }) => context.noAgentHops + 1,
    }),
    clearEdgeAction: assign({ edgeAction: () => undefined }),
    applyPayload: assign(({ event }) => {
      if (event.type !== "RESOLVE") return {}
      const p = event.payload
      return {
        // Cleared here; action-leaf entry actions re-set it afterwards.
        edgeAction: undefined,
        lastCommitSubject: p.lastCommitSubject,
        workingTreeClean: p.workingTreeClean,
        packages: p.packages,
        diff: p.diff,
        ...(p.baseRef !== undefined ? { baseRef: p.baseRef } : {}),
        ...(p.refDiff !== undefined ? { refDiff: p.refDiff } : {}),
      }
    }),
  },
}).createMachine({
  id: "gtd",
  initial: "replaying",
  context: initialContext,
  states: {
    replaying: {
      on: {
        COMMIT: { actions: "foldCommit" },
        RESOLVE: resolveChain(["applyPayload"]),
      },
    },
    // ── No-agent action leaves ──────────────────────────────────────────────
    // No longer `type:"final"`: each emits an `edgeAction` on entry, records
    // itself as `lastAdvancedLeaf`, and on the NEXT `RESOLVE` runs `foldAdvance`
    // (bumping `noAgentHops`) then re-evaluates the full guard chain. An `always`
    // escalation fires when the hop cap is hit or no progress was made (`stuck`).
    "close-review": {
      tags: ["auto-advance"],
      entry: assign({
        edgeAction: ({ context }) =>
          ({ kind: "closeReview", base: context.baseRef! }) satisfies EdgeAction,
        lastAdvancedLeaf: () => "close-review" as LeafState,
      }),
      always: [
        { guard: "noAgentCapReached", target: "escalate", actions: "clearEdgeAction" },
      ],
      on: { RESOLVE: resolveChain(["foldAdvance", "applyPayload"], "close-review") },
    },
    "code-changes": {
      tags: ["auto-advance"],
      entry: assign({
        edgeAction: () => ({ kind: "commitPending" }) satisfies EdgeAction,
        lastAdvancedLeaf: () => "code-changes" as LeafState,
      }),
      always: [
        { guard: "noAgentCapReached", target: "escalate", actions: "clearEdgeAction" },
      ],
      on: { RESOLVE: resolveChain(["foldAdvance", "applyPayload"], "code-changes") },
    },
    cleanup: {
      tags: ["auto-advance"],
      entry: assign({
        edgeAction: () => ({ kind: "removeGtdDir" }) satisfies EdgeAction,
        lastAdvancedLeaf: () => "cleanup" as LeafState,
      }),
      always: [
        { guard: "noAgentCapReached", target: "escalate", actions: "clearEdgeAction" },
      ],
      on: { RESOLVE: resolveChain(["foldAdvance", "applyPayload"], "cleanup") },
    },
    // ── Test gate (execute only) ────────────────────────────────────────────
    // Emits `runTestGate`, waits for a `TEST_RESULT`, then folds it exactly as
    // the retired `selectPrompt` did.
    runTestGate: {
      entry: assign({
        edgeAction: () => ({ kind: "runTestGate" }) satisfies EdgeAction,
      }),
      on: {
        TEST_RESULT: [
          { guard: "testGreen", target: "execute", actions: "clearEdgeAction" },
          {
            guard: "testRedBelowCap",
            target: "fix-tests",
            actions: assign({
              edgeAction: () => undefined,
              testOutput: ({ event }) =>
                event.type === "TEST_RESULT" ? event.output : undefined,
            }),
          },
          { guard: "testRedAtCap", target: "escalate", actions: "clearEdgeAction" },
        ],
      },
    },
    // ── Review pre-render ───────────────────────────────────────────────────
    // Emits `reviewPreRender`, waits for `REVIEW_RECORDED`, then settles on
    // `review-process` carrying the synthesis diff + recovery sha.
    "review-process": {
      tags: ["auto-advance"],
      entry: assign({
        edgeAction: ({ context }) =>
          ({ kind: "reviewPreRender", base: context.baseRef! }) satisfies EdgeAction,
      }),
      on: {
        REVIEW_RECORDED: {
          target: "review-process-ready",
          actions: assign({
            edgeAction: () => undefined,
            reviewDiff: ({ event }) =>
              event.type === "REVIEW_RECORDED" ? event.diff : undefined,
            recordSha: ({ event }) =>
              event.type === "REVIEW_RECORDED" ? event.recordSha : undefined,
          }),
        },
      },
    },
    // Settled review-process: same `value` as the prompt expects is NOT this id,
    // so the projection maps it back to "review-process" (see `projectValue`).
    "review-process-ready": { tags: ["auto-advance"], type: "final" },
    "review-incomplete": { type: "final" },
    "await-review": { type: "final" },
    execute: { tags: ["auto-advance"], type: "final" },
    "fix-tests": { type: "final" },
    decompose: { tags: ["auto-advance"], type: "final" },
    "execute-simple": { tags: ["auto-advance"], type: "final" },
    "new-todo": { tags: ["auto-advance"], type: "final" },
    "modified-todo": { tags: ["auto-advance"], type: "final" },
    "await-answers": { type: "final" },
    "human-review": { type: "final" },
    verified: { type: "final" },
    escalate: { type: "final" },
  },
})

export interface ResolveResult {
  readonly value: LeafState | "replaying"
  readonly context: GtdContext
  readonly autoAdvance: boolean
  /**
   * Present iff the settled state is an action leaf (or a gate) that wants the
   * edge to perform a side effect before continuing: removeGtdDir / closeReview
   * / commitPending / runTestGate / reviewPreRender. Absent once the action has
   * been performed and the leaf re-settled.
   */
  readonly edgeAction?: EdgeAction
}

type Snapshot = ReturnType<ReturnType<typeof createActor<typeof machine>>["getSnapshot"]>

/**
 * Snapshot → ResolveResult projection. Two internal states are mapped back onto
 * their public leaf value: `runTestGate` projects as `execute` (it gates the
 * execute leaf; its `edgeAction.kind === "runTestGate"` distinguishes the gate),
 * and `review-process-ready` projects as `review-process` (the settled synthesis
 * leaf). Every other value passes through unchanged.
 */
const project = (snapshot: Snapshot): ResolveResult => {
  const raw = snapshot.value as string
  const value: LeafState | "replaying" =
    raw === "runTestGate"
      ? "execute"
      : raw === "review-process-ready"
        ? "review-process"
        : (raw as LeafState | "replaying")
  return {
    value,
    context: snapshot.context,
    autoAdvance: snapshot.hasTag("auto-advance"),
    ...(snapshot.context.edgeAction !== undefined
      ? { edgeAction: snapshot.context.edgeAction }
      : {}),
  }
}

/**
 * A long-lived stepping handle over a single running actor. `current` is the
 * projection after the events passed to `start`; `advance` sends more events to
 * the SAME actor (re-evaluating guards) and returns the new projection.
 */
export interface Handle {
  readonly current: ResolveResult
  readonly advance: (events: ReadonlyArray<GtdEvent>) => ResolveResult
}

/**
 * Open a long-lived actor, fold in `events`, and return a stepping `Handle`.
 * The machine is pure: any IO result (test exit code, recorded review diff)
 * flows back in only as a later `TEST_RESULT` / `REVIEW_RECORDED` event.
 */
export const start = (events: ReadonlyArray<GtdEvent>): Handle => {
  const actor = createActor(machine)
  actor.start()
  for (const event of events) actor.send(event)
  return {
    get current() {
      return project(actor.getSnapshot())
    },
    advance: (next) => {
      for (const event of next) actor.send(event)
      return project(actor.getSnapshot())
    },
  }
}

/**
 * Pure fold wrapper retained for existing callers that only read
 * `value`/`context`/`autoAdvance`. Equivalent to `start(events).current`.
 */
export const resolve = (events: ReadonlyArray<GtdEvent>): ResolveResult => start(events).current
