import type { EdgeAction, GtdState, TurnPrediction } from "./Machine.js"

/**
 * The thin decision core `program.ts` calls. There is no long-lived actor:
 * `resolve` (src/Machine.ts) is a pure function, so a "step" is just
 * `gatherEvents(invoker)` (the Effect edge) folded through `resolve()`. The
 * driver performs the returned `edgeAction` (`Events.perform`), then resolves
 * again — gather → resolve is the unit of progress.
 */

/** A pure, IO-free summary of the predicted next turn, for `gtd status`. */
export interface StatusSummary {
  readonly state: GtdState
  readonly actor: "human" | "agent"
  readonly predictedCommit: string | null
  readonly predictedState: GtdState
}

type EdgeActionHandlers = {
  readonly [K in EdgeAction["kind"]]: (a: Extract<EdgeAction, { kind: K }>) => string
}

/** Renders one human-readable phrase for each v2 `EdgeAction` variant. */
const edgeActionHandlers: EdgeActionHandlers = {
  captureTurn: (a) => `capture the ${a.actor} turn as "gtd(${a.actor}): ${a.gate}"`,
  commitRouting: (a) => {
    let msg = `commit routing as "${a.subject}"`
    if (a.seedArchitectureFromTodo) {
      msg += " (seeding .gtd/ARCHITECTURE.md from .gtd/TODO.md)"
    }
    if (a.seedArchitectureFromPlan) {
      msg += " (seeding .gtd/ARCHITECTURE.md from .gtd/PLAN.md)"
    }
    const removed: string[] = []
    if (a.removeArchitecture) removed.push(".gtd/ARCHITECTURE.md")
    if (a.removeReview) removed.push(".gtd/REVIEW.md")
    if (a.removeFeedback) removed.push(".gtd/FEEDBACK.md")
    if (a.removeHealth) removed.push(".gtd/HEALTH.md")
    if (a.removeLearning) removed.push(".gtd/LEARNINGS.md")
    if (removed.length > 0) msg += ` (removing ${removed.join(", ")})`
    return msg
  },
  runTest: (a) =>
    `run the test suite (attempt ${a.errorCount + 1}${a.capReached ? ", cap reached" : ""})`,
  closePackage: () => "close the active package",
  writeSquashTemplate: () => "write the squash message template",
  squashCommit: (a) => `squash the cycle onto ${a.squashBase}`,
  writeLearningTemplate: () => "write the learnings template",
  runHealthCheck: (a) =>
    `run the health check (attempt ${a.errorCount + 1}${a.capReached ? ", cap reached" : ""}${
      a.chainAfterGreen ? ", chain after green" : ""
    })`,
}

/** Total presenter over the v2 `EdgeAction` union — one phrase per variant. */
export const describeEdgeAction = (a: EdgeAction): string =>
  (edgeActionHandlers[a.kind] as (a: EdgeAction) => string)(a)

/** Pure fold of a `TurnPrediction` into a `StatusSummary`. Performs no IO. */
export const describeStatus = (prediction: TurnPrediction): StatusSummary => ({
  state: prediction.state,
  actor: prediction.actor,
  predictedCommit: prediction.subject,
  predictedState: prediction.state,
})
