import type { StepDef } from "../Workflow.js"
import type { RepoSnapshot } from "./RepoSnapshot.js"

/**
 * One `RepoSnapshot` literal for a table test: every field is already-resolved
 * data, exactly what `planStep` receives. The landing defaults to a
 * commit that stays at `state`.
 */
export const snapshot = (
  overrides: Partial<Omit<RepoSnapshot, "stepDef">> & {
    readonly state: string
    readonly stepDef: Partial<StepDef>
  },
): RepoSnapshot => {
  const stepDef: StepDef = { actor: "human", kind: "message", content: "", ...overrides.stepDef }
  return {
    actor: stepDef.actor,
    changes: [],
    file: stepDef.file,
    landing: {
      kind: "commit",
      to: overrides.state,
      spec: { actor: stepDef.actor, from: overrides.state, to: overrides.state },
    },
    ...overrides,
    stepDef,
  }
}
