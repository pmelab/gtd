import type { CommitSpec } from "../replay/index.js"
import type { PendingChange, StateName, StepDef } from "../Workflow.js"

/**
 * What landing the pending turn does, decided at the edge by replaying the
 * episode with the working tree as the pending turn.
 */
export type Landing =
  | { readonly kind: "refusal"; readonly message: string }
  /** Nothing to land. `settled` when re-running the rest cannot change that. */
  | { readonly kind: "noop"; readonly settled: boolean }
  /** An empty agent turn: recorded, but the process stays at the step. */
  | { readonly kind: "attempt"; readonly subject: string }
  | { readonly kind: "commit"; readonly to: StateName; readonly spec: CommitSpec }

/**
 * Everything `planStep` needs, already resolved
 * from git/config/workspace ONCE, before any perform — a frozen value cannot
 * observe a perform.
 */
export interface RepoSnapshot {
  readonly stepDef: StepDef
  readonly state: StateName
  readonly actor: string
  readonly changes: readonly PendingChange[]
  /** The resting step's steering file, `undefined` when it declares none. */
  readonly file: string | undefined
  readonly landing: Landing
}
