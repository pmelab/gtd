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
export const MAX_VERIFY_ITERATIONS = 5

export interface GtdPackageFact {
  readonly name: string
  readonly tasks: ReadonlyArray<string>
}

/**
 * Terminal working-tree facts the RESOLVE guards branch on, plus passthrough
 * fields that flow straight onto the resulting leaf context.
 */
export interface ResolvePayload {
  /** REVIEW.md exists with user edits. */
  readonly reviewModified: boolean
  /** Any non-TODO.md uncommitted change is present. */
  readonly codeDirty: boolean
  /** `.gtd/` contains work packages to execute. */
  readonly hasPackages: boolean
  /** `.gtd/` exists (possibly empty). */
  readonly gtdDirExists: boolean
  /** Uncommitted state of TODO.md, if any. */
  readonly todoDirty: "new" | "modified" | null
  /** TODO.md exists and has no unanswered question markers. */
  readonly todoFinalized: boolean
  /** TODO.md is marked `<!-- simple -->`. */
  readonly todoSimple: boolean
  /** A review base ref is available to diff against. */
  readonly reviewBasePresent: boolean
  // passthrough
  readonly lastCommitSubject: string
  readonly workingTreeClean: boolean
  readonly packages: ReadonlyArray<GtdPackageFact>
  readonly diff: string
  readonly baseRef?: string
  readonly refDiff?: string
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
}

/** Terminal leaf-state ids. These are the only non-`replaying` states. */
export type LeafState =
  | "review-process"
  | "code-changes"
  | "execute"
  | "cleanup"
  | "decompose"
  | "execute-simple"
  | "escalate"
  | "new-todo"
  | "modified-todo"
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
    reviewModified: (_, params: ResolvePayload) => params.reviewModified,
    codeDirty: (_, params: ResolvePayload) => params.codeDirty,
    hasPackages: (_, params: ResolvePayload) => params.hasPackages,
    gtdDirExists: (_, params: ResolvePayload) => params.gtdDirExists,
    todoFinalized: (_, params: ResolvePayload) => params.todoFinalized,
    todoFinalizedSimple: (_, params: ResolvePayload) => params.todoFinalized && params.todoSimple,
    capReached: ({ context }) => context.verifyIterations >= context.maxVerifyIterations,
    todoNew: (_, params: ResolvePayload) => params.todoDirty === "new",
    todoModified: (_, params: ResolvePayload) => params.todoDirty === "modified",
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
            guard: { type: "reviewModified", params: ({ event }) => event.payload },
            target: "review-process",
            actions: "applyPayload",
          },
          {
            guard: { type: "codeDirty", params: ({ event }) => event.payload },
            target: "code-changes",
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
            guard: { type: "todoFinalizedSimple", params: ({ event }) => event.payload },
            target: "execute-simple",
            actions: "applyPayload",
          },
          {
            guard: { type: "todoFinalized", params: ({ event }) => event.payload },
            target: "decompose",
            actions: "applyPayload",
          },
          {
            guard: "capReached",
            target: "escalate",
            actions: "applyPayload",
          },
          {
            guard: { type: "todoNew", params: ({ event }) => event.payload },
            target: "new-todo",
            actions: "applyPayload",
          },
          {
            guard: { type: "todoModified", params: ({ event }) => event.payload },
            target: "modified-todo",
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
    "review-process": { tags: ["auto-advance"], type: "final" },
    "code-changes": { tags: ["auto-advance"], type: "final" },
    execute: { tags: ["auto-advance"], type: "final" },
    cleanup: { tags: ["auto-advance"], type: "final" },
    decompose: { tags: ["auto-advance"], type: "final" },
    "execute-simple": { tags: ["auto-advance"], type: "final" },
    "new-todo": { tags: ["auto-advance"], type: "final" },
    "modified-todo": { tags: ["auto-advance"], type: "final" },
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
