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

/** A `!!` follow-up comment found in tracked source (mirror of Git.BangComment). */
export interface BangComment {
  readonly file: string
  readonly line: string
  readonly text: string
}

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
  /** REVIEW.md was approved with no code changes needed (all forward ticks). */
  readonly reviewApprovedNoChanges: boolean
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
  /** A `!!` follow-up comment is present in tracked source. */
  readonly bangPresent: boolean
  /** A review base ref is available to diff against. */
  readonly reviewBasePresent: boolean
  // passthrough
  readonly lastCommitSubject: string
  readonly workingTreeClean: boolean
  readonly packages: ReadonlyArray<GtdPackageFact>
  readonly diff: string
  readonly baseRef?: string
  readonly refDiff?: string
  readonly bangComments?: ReadonlyArray<BangComment>
}

export type GtdEvent =
  | { type: "COMMIT"; isFixGtd: boolean }
  | { type: "RESOLVE"; payload: ResolvePayload }

export interface GtdContext {
  verifyIterations: number
  maxVerifyIterations: number
  lastCommitSubject: string
  workingTreeClean: boolean
  packages: ReadonlyArray<GtdPackageFact>
  diff: string
  baseRef?: string
  refDiff?: string
  bangComments?: ReadonlyArray<BangComment>
}

/** Terminal leaf-state ids. These are the only non-`replaying` states. */
export type LeafState =
  | "close-review"
  | "review-process"
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

const initialContext: GtdContext = {
  verifyIterations: 0,
  maxVerifyIterations: MAX_VERIFY_ITERATIONS,
  lastCommitSubject: "",
  workingTreeClean: true,
  packages: [],
  diff: "",
}

const machine = setup({
  types: {
    context: {} as GtdContext,
    events: {} as GtdEvent,
  },
  guards: {
    errorsPresent: (_, params: ResolvePayload) => params.errorsPresent,
    // A `!!` follow-up comment is leftover work, so it diverts an otherwise
    // approved review into the review-process loop instead of closing it.
    reviewApprovedClose: (_, params: ResolvePayload) =>
      params.reviewApprovedNoChanges && !params.bangPresent,
    reviewModified: (_, params: ResolvePayload) => params.reviewModified,
    reviewUnmodified: (_, params: ResolvePayload) => params.reviewUnmodified,
    codeDirty: (_, params: ResolvePayload) => params.codeDirty,
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
  },
  actions: {
    foldCommit: assign({
      verifyIterations: ({ context, event }) => {
        if (event.type !== "COMMIT") return context.verifyIterations
        return event.isFixGtd ? context.verifyIterations + 1 : 0
      },
    }),
    applyPayload: assign(({ event }) => {
      if (event.type !== "RESOLVE") return {}
      const p = event.payload
      return {
        lastCommitSubject: p.lastCommitSubject,
        workingTreeClean: p.workingTreeClean,
        packages: p.packages,
        diff: p.diff,
        ...(p.baseRef !== undefined ? { baseRef: p.baseRef } : {}),
        ...(p.refDiff !== undefined ? { refDiff: p.refDiff } : {}),
        ...(p.bangComments !== undefined ? { bangComments: p.bangComments } : {}),
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
        RESOLVE: [
          {
            guard: { type: "errorsPresent", params: ({ event }) => event.payload },
            target: "escalate",
            actions: "applyPayload",
          },
          {
            guard: { type: "reviewApprovedClose", params: ({ event }) => event.payload },
            target: "close-review",
            actions: "applyPayload",
          },
          {
            guard: { type: "codeDirty", params: ({ event }) => event.payload },
            target: "code-changes",
            actions: "applyPayload",
          },
          {
            guard: { type: "reviewModified", params: ({ event }) => event.payload },
            target: "review-process",
            actions: "applyPayload",
          },
          {
            guard: { type: "reviewUnmodified", params: ({ event }) => event.payload },
            target: "await-review",
            actions: "applyPayload",
          },
          {
            guard: { type: "hasPackages", params: ({ event }) => event.payload },
            target: "execute",
            actions: "applyPayload",
          },
          {
            guard: { type: "gtdDirExists", params: ({ event }) => event.payload },
            target: "cleanup",
            actions: "applyPayload",
          },
          {
            guard: { type: "todoSimple", params: ({ event }) => event.payload },
            target: "execute-simple",
            actions: "applyPayload",
          },
          {
            guard: { type: "todoComplete", params: ({ event }) => event.payload },
            target: "decompose",
            actions: "applyPayload",
          },
          {
            guard: "capReached",
            target: "escalate",
            actions: "applyPayload",
          },
          {
            guard: { type: "todoAwaitAnswers", params: ({ event }) => event.payload },
            target: "await-answers",
            actions: "applyPayload",
          },
          {
            guard: { type: "todoRegrill", params: ({ event }) => event.payload },
            target: "modified-todo",
            actions: "applyPayload",
          },
          {
            guard: { type: "todoInitial", params: ({ event }) => event.payload },
            target: "new-todo",
            actions: "applyPayload",
          },
          {
            guard: { type: "humanReview", params: ({ event }) => event.payload },
            target: "human-review",
            actions: "applyPayload",
          },
          {
            target: "verified",
            actions: "applyPayload",
          },
        ],
      },
    },
    "close-review": { tags: ["auto-advance"], type: "final" },
    "review-process": { tags: ["auto-advance"], type: "final" },
    "await-review": { type: "final" },
    "code-changes": { tags: ["auto-advance"], type: "final" },
    execute: { tags: ["auto-advance"], type: "final" },
    cleanup: { tags: ["auto-advance"], type: "final" },
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
}

/**
 * Pure fold: feed events in order, return the resulting leaf state value, its
 * context, and whether the leaf carries the `auto-advance` tag. Synchronous —
 * no actors/invoke/delays are used by the machine.
 */
export const resolve = (events: ReadonlyArray<GtdEvent>): ResolveResult => {
  const actor = createActor(machine)
  actor.start()
  for (const event of events) actor.send(event)
  const snapshot = actor.getSnapshot()
  return {
    value: snapshot.value as LeafState | "replaying",
    context: snapshot.context,
    autoAdvance: snapshot.hasTag("auto-advance"),
  }
}
