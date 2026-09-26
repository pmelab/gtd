import type { CommitSpec } from "../replay/index.js"
import type { PendingChange, StateName, StepDef } from "../Workflow.js"

/**
 * The require-revert guard's own git fact: whether the current process even
 * has an identifiable review round (`checked`), the base it diffed against
 * (`base`), and any code path that still differs from that base after the
 * round's commits (`residue`, empty means the revert took).
 */
export interface RevertProbe {
  readonly checked: boolean
  readonly base: string
  readonly residue: readonly string[]
}

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
 * Everything `planStep` and the step-capture guards need, already resolved
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
  readonly reviewBase: string
  readonly startCommit: string
  /** `file`'s contents at HEAD (pre-turn), `undefined` when absent there or `file` is `undefined`. */
  readonly headFile: string | undefined
  /** `file`'s CURRENT working-tree contents, `undefined` when absent on disk or `file` is `undefined`. */
  readonly worktreeFile: string | undefined
  readonly revert: RevertProbe
  readonly landing: Landing
}
