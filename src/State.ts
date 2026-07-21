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
  readonly actor: string
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
    const notes: ReadonlyArray<readonly [boolean | undefined, string]> = [
      [a.seedArchitectureFromTodo, "seeding .gtd/ARCHITECTURE.md from .gtd/TODO.md"],
      [a.seedArchitectureFromPlan, "seeding .gtd/ARCHITECTURE.md from .gtd/PLAN.md"],
      [a.promoteCheckOutputToErrors, "promoting the check output to .gtd/ERRORS.md"],
    ]
    const removals: ReadonlyArray<readonly [boolean | undefined, string]> = [
      [a.removeArchitecture, ".gtd/ARCHITECTURE.md"],
      [a.removeReview, ".gtd/REVIEW.md"],
      [a.removeFeedback, ".gtd/FEEDBACK.md"],
      [a.removeHealth, ".gtd/HEALTH.md"],
      [a.removeLearning, ".gtd/LEARNINGS.md"],
    ]
    const removed = removals.filter(([on]) => on === true).map(([, path]) => path)
    const suffixes = [
      ...notes.filter(([on]) => on === true).map(([, note]) => ` (${note})`),
      ...(removed.length > 0 ? [` (removing ${removed.join(", ")})`] : []),
    ]
    return `commit routing as "${a.subject}"${suffixes.join("")}`
  },
  closePackage: () => "close the active package",
  writeSquashTemplate: () => "write the squash message template",
  squashCommit: (a) => `squash the cycle onto ${a.squashBase}`,
  writeLearningTemplate: () => "write the learnings template",
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
