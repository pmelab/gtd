import type { StepDef } from "../Workflow.js"
import type { RepoSnapshot, RevertProbe } from "./RepoSnapshot.js"

const NO_REVERT: RevertProbe = { checked: false, base: "", residue: [] }

/**
 * One `RepoSnapshot` literal for a table test: every field is already-resolved
 * data, exactly what `planStep`/the guards receive. The landing defaults to a
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
    reviewBase: "",
    startCommit: "",
    headFile: undefined,
    worktreeFile: undefined,
    revert: NO_REVERT,
    landing: {
      kind: "commit",
      to: overrides.state,
      spec: { actor: stepDef.actor, from: overrides.state, to: overrides.state },
    },
    ...overrides,
    stepDef,
  }
}
