import type { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import type { ConfigService } from "./Config.js"
import { gatherEvents } from "./Events.js"
import type { GitService } from "./Git.js"
import { Cwd } from "./Cwd.js"
import { type EdgeAction, type GtdState, resolve, type Result } from "./Machine.js"

/**
 * The thin decision core the driver loop in `main.ts` calls. There is no
 * long-lived actor any more: `resolve` (src/Machine.ts) is a pure function, so
 * "stepping" the machine is just `gatherEvents()` (the Effect edge) folded
 * through `resolve()`. The driver performs the returned `edgeAction`
 * (`Events.perform`), then calls `detect()` again — gather → resolve is the unit
 * of progress, not an `advance(event)` on a stateful handle.
 *
 * The old long-lived actor (its open/step/advance surface), the test-result and
 * review-record feedback events it consumed, and the duplicated review-base
 * computation are all gone — those results are handled at the edge and never
 * re-enter the machine.
 */

/**
 * The eight edge-only states: the driver performs their `edgeAction`, then
 * re-gathers + re-resolves WITHOUT printing a prompt (they auto-advance through
 * the deterministic chain within one invocation). Mirrors the `EDGE_ONLY_STATES`
 * set in `Prompt.ts` — these are exactly the states `buildPrompt` refuses to
 * render. Every other state is prompt-bearing: the driver stops on it and emits
 * its single prompt (even when it also carries an `edgeAction`, e.g. Fixing /
 * Grilling / Planning / Await Review commit their pending tree, then prompt).
 *
 * Edge-only states: transport, new-feature, testing, await-review,
 * accept-review, close-package, done, health-check.
 */
export const EDGE_ONLY_STATES: ReadonlySet<GtdState> = new Set<GtdState>([
  "transport",
  "new-feature",
  "testing",
  "await-review",
  "accept-review",
  "close-package",
  "done",
  "health-check",
])

/** True when the driver must auto-advance (re-gather + re-resolve) past `state` rather than prompt. */
export const isEdgeOnly = (state: GtdState): boolean => EDGE_ONLY_STATES.has(state)

/** A pure, IO-free summary of the current gtd state derived from a resolved `Result`. */
export interface StatusSummary {
  readonly state: GtdState
  readonly nextState: GtdState | null
  readonly willAutoAdvance: boolean
  readonly edgeActions: readonly string[]
}

type EdgeActionHandlers = {
  readonly [K in EdgeAction["kind"]]: (a: Extract<EdgeAction, { kind: K }>) => string
}

/** Renders one human-readable phrase for each `EdgeAction` variant. */
const edgeActionHandlers: EdgeActionHandlers = {
  transportReset: () => "reset the working tree to the gtd: transport parent",
  seedNewFeature: () => "seed a new feature (write the initial TODO.md)",
  seedAcceptReview: () => "seed the accept-review step",
  captureGrillingEdits: () => "capture pending grilling edits into TODO.md",
  runTest: (a) =>
    `run the test suite (attempt ${a.errorCount + 1}${a.capReached ? ", cap reached" : ""})`,
  commitPending: (a) => {
    let msg = `commit pending changes as "${a.prefix}"`
    if (a.removeTodo) msg += " (removing TODO.md)"
    if (a.removeFeedback) msg += " (removing FEEDBACK.md)"
    if (a.removeHealth) msg += " (removing HEALTH.md)"
    return msg
  },
  runHealthCheck: (a) =>
    `run the health check${a.commitErrorsReset ? " (resetting the error budget)" : ""}`,
  closePackage: () => "close the active package (commit gtd: package done)",
  commitReview: () => "commit the review record (REVIEW.md)",
  done: () => "finalize the review cycle (commit gtd: done)",
  squashCommit: (a) => `squash the cycle onto ${a.squashBase}`,
  removeHealthSentinel: () =>
    "remove the health-squash sentinel before prompting for a squash message",
  removeStraySquashMsg: () => "remove a stray SQUASH_MSG.md",
}

const describeEdgeAction = (a: EdgeAction): string =>
  (edgeActionHandlers[a.kind] as (a: EdgeAction) => string)(a)

/** Pure fold of a resolved `Result` into a `StatusSummary`. Performs no IO. */
export const describeStatus = (result: Result): StatusSummary => {
  const willAutoAdvance = isEdgeOnly(result.state)
  return {
    state: result.state,
    nextState: willAutoAdvance ? null : result.state,
    willAutoAdvance,
    edgeActions: result.edgeAction ? [describeEdgeAction(result.edgeAction)] : [],
  }
}

/**
 * Gather every git/filesystem fact (the only IO, in `Events.gatherEvents`) and
 * fold it through the pure resolver to a single `Result` (state + optional
 * `edgeAction` + prompt context).
 *
 * `resolve` THROWS `GtdStateError` for an illegal steering-file combination or
 * for corruption (no precedence rule matched). It runs inside `Effect.try` so
 * that throw surfaces in the failure channel and is caught by the composition
 * root's `Effect.catchAll` (→ `gtd: <message>` on stderr, exit 1) rather than
 * escaping as an unhandled defect.
 */
export const detect = (): Effect.Effect<
  Result,
  Error,
  GitService | FileSystem.FileSystem | ConfigService | Cwd
> =>
  Effect.gen(function* () {
    const events = yield* gatherEvents()
    return yield* Effect.try({
      try: () => resolve(events),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
  })
