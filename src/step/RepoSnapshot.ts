import type {
  Actor,
  PendingChange,
  StateDef,
  StateName,
  WorkflowDefinition,
} from "../PatternMachine.js"

/**
 * The require-revert guard's own git fact: whether the current process even
 * has an identifiable review round (`checked`), the base it diffed against
 * (`base`), and any code path that still differs from that base after the
 * round's commits (`residue`, empty means the revert took). The adapter that
 * builds a `RepoSnapshot` (`Edge.ts`'s `snapshotFromRest`) computes this only
 * when the resting state actually declares `requireRevert` AND the decision
 * isn't an ATTEMPT (which bypasses every guard) — a real git backend can't
 * offer a genuinely synchronous, called-on-first-use thunk (the command
 * executor is inherently async), so this is a plain eagerly-computed field,
 * gated at the point it's built rather than at the point it's read.
 */
export interface RevertProbe {
  readonly checked: boolean
  readonly base: string
  readonly residue: readonly string[]
}

/**
 * Everything `planStep` (and the step-capture guards) need to decide a step,
 * already resolved from git/config/workspace ONCE, before any perform — a
 * frozen value cannot observe a perform, which is what makes "never read a
 * snapshot after a perform" true by construction rather than by convention
 * (see `Edge.ts`'s `Rest` doc comment, the thing this type replaces on the
 * planning path).
 *
 * Narrower than the illustrative sketch in `.gtd/packages/05-step-core.md`:
 * that sketch's `files` is a generic path→bytes map, but every guard today
 * only ever inspects the RESTING STATE'S OWN steering file, never another
 * path — so this carries that one file's committed/worktree bytes by name
 * rather than a map nothing else would ever populate. Widen it to a map only
 * when a guard actually needs a second file.
 */
export interface RepoSnapshot {
  readonly def: WorkflowDefinition
  /** `def` with the resting state's `on` edges already rendered against `vars` — what `PatternMachine.step` must be fed. */
  readonly stepDef: WorkflowDefinition
  readonly state: StateName
  readonly stateDef: StateDef
  readonly actor: Actor
  readonly changes: readonly PendingChange[]
  /** States entered since the current process started, oldest → newest (mirrors `ProcessRun.trace`, names only). */
  readonly processTrace: readonly StateName[]
  /** The resting state's rendered `file:`, `undefined` when it declares none. */
  readonly file: string | undefined
  readonly reviewBase: string
  readonly startCommit: string
  /** `file`'s contents at HEAD (pre-turn), `undefined` when absent there or `file` is `undefined`. */
  readonly headFile: string | undefined
  /** `file`'s CURRENT working-tree contents, `undefined` when absent on disk or `file` is `undefined`. */
  readonly worktreeFile: string | undefined
  readonly revert: RevertProbe
}
