import {
  contentKindOf,
  step,
  type RouteAnswer,
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
 * One answered question off a `gtd judge answer` verdict — the same shape
 * `src/program.ts`'s `verdictSchemaFor` decodes off stdin. Recorded as its own
 * `Gtd-Judge:` trailer line (one per entry), the way `opts.cost` becomes
 * `Gtd-Cost:` below — `src/Edge.ts`'s `computeProcessRun` scans both off the
 * same `<startCommit>..HEAD` range.
 */
export interface JudgeVerdict {
  readonly id: string
  readonly answer: string | number | boolean
  readonly p: number
}

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
  judge: readonly JudgeVerdict[] | undefined,
  truncated: boolean | undefined,
): readonly LandStep[] => {
  const trailerLines = [
    cost === undefined ? undefined : `Gtd-Cost: ${cost}${model !== undefined ? ` ${model}` : ""}`,
    ...(judge ?? []).map((verdict) => `Gtd-Judge: ${JSON.stringify(verdict)}`),
    // Emitted only when true — a missing trailer reads as not truncated, so
    // an ordinary `gtd land` (never passes `truncated`) and a judged-but-
    // under-budget verdict both land silent, exactly like an absent
    // `Gtd-Judge:` reads as "no verdict recorded".
    truncated === true ? `Gtd-Payload: ${JSON.stringify({ truncated: true })}` : undefined,
  ].filter((line): line is string => line !== undefined)
  const subjectWithTrailer =
    trailerLines.length === 0
      ? decision.subject
      : `${decision.subject}\n\n${trailerLines.join("\n")}`
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

/**
 * A `gtd judge answer` verdict, shaped for `routes:` matching — `answer`
 * normalized to a string since `RouteAnswer.answer` (compared against a route
 * row's own string `is`) is string-only, while a verdict's `answer` covers
 * every `judge:` primitive (`noul` → boolean, `choice` → string, `score` →
 * number). A `noul`'s boolean becomes `"yes"`/`"no"` — the documented `is:`
 * vocabulary every doc site (`StateFields.ts`'s `RouteRow`/`ROUTES_JSON_SCHEMA`,
 * `docs/configuration.md`) names for it — NOT `String(true)` ("true"), which
 * an author writing `is: "yes"` per that same documentation could never match:
 * the row silently falls through to the catch-all, no load error, no runtime
 * signal. `choice` (already a string) and `score` (a number, `String(3)` →
 * `"3"`, matching "a score's level") pass through `String()` unchanged.
 */
const asRouteAnswers = (judge: readonly JudgeVerdict[] | undefined): readonly RouteAnswer[] =>
  (judge ?? []).map((v) => ({
    id: v.id,
    answer: typeof v.answer === "boolean" ? (v.answer ? "yes" : "no") : String(v.answer),
    p: v.p,
  }))

export const planStep = (
  snapshot: RepoSnapshot,
  opts: {
    readonly cost?: number
    readonly model?: string
    readonly judge?: readonly JudgeVerdict[]
    readonly truncated?: boolean
  } = {},
): StepOutcome => {
  const { cost, model, judge, truncated } = opts
  // `routeAnswers` is `undefined` (not `[]`) when no verdict was answered
  // THIS call — `step`'s `routes:` precedence only applies when a verdict was
  // actually supplied; an ordinary `gtd land` (no `judge` opt) must fall
  // through to the state's own `on:`, the "skipped judgment" path.
  const decision = step(snapshot.stepDef, snapshot.state, snapshot.actor, {
    changes: snapshot.changes,
    processTrace: snapshot.processTrace,
    ...(judge !== undefined ? { routeAnswers: asRouteAnswers(judge) } : {}),
  })

  if (decision.kind === "refusal") {
    return { kind: "refusal", message: formatStepRefusal(decision) }
  }
  if (decision.kind === "noop") {
    return { kind: "noop", state: decision.state, settled: noOpSettles(snapshot) }
  }

  const steps = renderDecision(snapshot, decision, cost, model, judge, truncated)
  const guardVerdict = decision.attempt === true ? undefined : enforceStepGuards(snapshot)

  return { kind: "commit", state: snapshot.state, decision, steps, guardVerdict }
}
