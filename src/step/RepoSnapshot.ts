import type { CommitSpec } from "../replay/index.js"
import type { PendingChange, StateName, StepDef } from "../workflow/index.js"
import type { ShipSpec } from "./LandStep.js"

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
  | {
      readonly kind: "commit"
      readonly to: StateName
      readonly spec: CommitSpec
      /** The full history ref a finishing landing points at its own commit. */
      readonly keepHistory?: string
      /** The kept ref this landing's turn goes to; the branch gets a marker commit instead. */
      readonly keepTurn?: string
      /** The `gtd/<b>` branch a starting landing switches to before it commits. */
      readonly startBranch?: string
      /** The user's branch `<b>` a finishing landing switches back to, after its history ref. */
      readonly leaveBranch?: string
      /** A remote the closing or shipping landing force-pushes its history ref to, after the commit. */
      readonly pushHistory?: string
      /** A ship step's squash onto the user's branch, made ahead of the landing commit. */
      readonly ship?: ShipSpec
      /** Printed after the landing: why a ship step shipped nothing. */
      readonly note?: string
      /** The one path this landing commits; every other pending change stays pending. */
      readonly only?: string
    }

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
