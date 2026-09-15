import {
  contentKindOf,
  step,
  type StateName,
  type StepDecision,
  type StepRefusal,
} from "../PatternMachine.js"
import { enforceStepGuards, isHumanReviewGate, type Refusal } from "./Guards.js"
import type { LandStep } from "./LandStep.js"
import type { RepoSnapshot } from "./RepoSnapshot.js"

/**
 * The user-facing message for a `land` refusal — out-of-turn names the
 * awaited actor, no-match names every declared pattern.
 */
const formatStepRefusal = (refusal: StepRefusal): string =>
  refusal.reason === "out-of-turn"
    ? `gtd land: out of turn — "${refusal.state}" awaits ${refusal.awaits}`
    : `gtd land: no declared pattern matches the pending changes at "${refusal.state}" — declared patterns: ${
        refusal.patterns.length > 0 ? refusal.patterns.join(", ") : "(none)"
      }`

/**
 * A no-op is TERMINAL only at a `script` rest (`gtd land`'s exit-3 `settled`
 * signal) — see `Edge.ts`'s `noOpSettles`, which this mirrors exactly.
 */
const noOpSettles = (snapshot: RepoSnapshot): boolean =>
  contentKindOf(snapshot.stateDef) === "script"

/**
 * A decision whose emitted steps write git — the one kind a guard may run
 * before. No caller annotates a variable with this name yet (every call
 * site narrows `StepOutcome.decision.kind` and lets it infer) — exported via
 * the barrel anyway, alongside `StepOutcome`, as part of the public outcome
 * vocabulary.
 */
// fallow-ignore-next-line unused-type
export type ExecutableDecision = Extract<StepDecision, { kind: "commit" }>

/**
 * Render a `"commit"` decision as `LandStep`s — DATA, never shell text. The
 * one place a decision becomes a git effect description; `src/GitScript.ts`
 * is the only place this data becomes runnable shell.
 *
 * At the human review gate an unconditional `gtd uncheck '<file>'` step runs
 * ahead of the commit, resetting every checkbox before `git add -A` picks it
 * up — a tick is read-progress, never sign-off.
 */
const renderDecision = (
  snapshot: RepoSnapshot,
  decision: ExecutableDecision,
  cost: number | undefined,
  model: string | undefined,
): readonly LandStep[] => {
  const subjectWithTrailer =
    cost === undefined
      ? decision.subject
      : `${decision.subject}\n\nGtd-Cost: ${cost}${model !== undefined ? ` ${model}` : ""}`
  const file = snapshot.file
  const uncheckStep: readonly LandStep[] =
    isHumanReviewGate(snapshot.stateDef) && file !== undefined ? [{ kind: "uncheck", file }] : []
  const outcome: LandStep =
    decision.from === decision.to
      ? { kind: "outcome", outcome: { kind: "commit", subject: decision.subject } }
      : { kind: "outcome", outcome: { kind: "transition", from: decision.from, to: decision.to } }
  return [
    ...uncheckStep,
    { kind: "gitWrite", write: { kind: "commitAll", message: subjectWithTrailer } },
    outcome,
  ]
}

/**
 * Decide a step — WITHOUT performing it, and WITHOUT touching git: every
 * fact this needs already sits on the frozen `snapshot`. gtd never writes
 * git; the decision becomes `steps` (data) plus `guardVerdict`, and only
 * `ScriptSurface.render(steps, guardVerdict)` (in `src/GitScript.ts`) turns
 * that pair into a runnable script — a guard cannot run late by
 * construction, since a `RunnableScript` is constructible only past that
 * gate.
 */
export type StepOutcome =
  | { readonly kind: "refusal"; readonly message: string }
  | { readonly kind: "noop"; readonly state: StateName; readonly settled: boolean }
  | {
      readonly kind: "commit"
      readonly state: StateName
      readonly decision: StepDecision
      readonly steps: readonly LandStep[]
      /** `undefined` when no guard applies, or the decision is an ATTEMPT (empty diff by construction — nothing for a guard to check). A guard's refusal reason otherwise. */
      readonly guardVerdict: Refusal
    }

export const planStep = (
  snapshot: RepoSnapshot,
  opts: { readonly cost?: number; readonly model?: string } = {},
): StepOutcome => {
  const decision = step(snapshot.stepDef, snapshot.state, snapshot.actor, {
    changes: snapshot.changes,
    processTrace: snapshot.processTrace,
  })

  if (decision.kind === "refusal") {
    return { kind: "refusal", message: formatStepRefusal(decision) }
  }
  if (decision.kind === "noop") {
    return { kind: "noop", state: decision.state, settled: noOpSettles(snapshot) }
  }

  const { cost, model } = opts
  const steps = renderDecision(snapshot, decision, cost, model)
  const guardVerdict = decision.attempt === true ? undefined : enforceStepGuards(snapshot)

  return { kind: "commit", state: snapshot.state, decision, steps, guardVerdict }
}
