import type { StateDef, WorkflowDefinition } from "../PatternMachine.js"
import type { RepoSnapshot, RevertProbe } from "./RepoSnapshot.js"

/** Never called unless a test explicitly overrides it — surfaces an unwanted git read immediately as a test failure rather than a silent `undefined`. */
const NO_REVERT: RevertProbe = { checked: false, base: "", residue: [] }

/**
 * Build one `RepoSnapshot` literal for a table test — no layers, no
 * `InMemRepo`, no `provide`: every field is already-resolved data, exactly
 * what `planStep`/the guards receive at runtime. `def` defaults to a
 * single-state workflow declaring `stateDef`, matching every other table
 * test's minimal-definition style.
 */
export const snapshot = (
  overrides: Partial<RepoSnapshot> & { readonly state: string; readonly stateDef: StateDef },
): RepoSnapshot => {
  const def: WorkflowDefinition = overrides.def ?? {
    states: { [overrides.state]: overrides.stateDef },
    entries: { default: overrides.state, manual: [] },
  }
  return {
    def,
    stepDef: def,
    actor: overrides.stateDef.actor ?? "human",
    changes: [],
    processTrace: [],
    file: undefined,
    reviewBase: "",
    startCommit: "",
    headFile: undefined,
    worktreeFile: undefined,
    revert: NO_REVERT,
    eachItems: {},
    ...overrides,
  }
}
