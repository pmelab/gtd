import { formatCommitMessage, type JudgeVerdict } from "../replay/index.js"
import type { StateName } from "../Workflow.js"
import type { LandStep } from "./LandStep.js"
import type { RepoSnapshot } from "./RepoSnapshot.js"

export type { JudgeVerdict }

/**
 * Decide a step — WITHOUT performing it, and WITHOUT touching git: every
 * fact this needs already sits on the frozen `snapshot`. gtd never writes
 * git; the decision becomes `steps` (data), and only `ScriptSurface.render`
 * turns them into a runnable script.
 */
export type StepOutcome =
  | { readonly kind: "refusal"; readonly message: string }
  | { readonly kind: "noop"; readonly state: StateName; readonly settled: boolean }
  | {
      readonly kind: "commit"
      readonly state: StateName
      /** The step the landing leaves the process resting at. */
      readonly to: StateName
      readonly subject: string
      readonly steps: readonly LandStep[]
    }

/**
 * At the human review gate an unconditional `gtd uncheck '<file>'` runs
 * ahead of the commit, resetting every checkbox before `git add -A` picks it
 * up — a tick is read-progress, never sign-off.
 */
const uncheckStep = (snapshot: RepoSnapshot): readonly LandStep[] =>
  snapshot.stepDef.actor === "human" &&
  snapshot.stepDef.mode === "review" &&
  snapshot.file !== undefined
    ? [{ kind: "uncheck", file: snapshot.file }]
    : []

export const planStep = (
  snapshot: RepoSnapshot,
  opts: {
    readonly cost?: number
    readonly model?: string
    readonly judge?: readonly JudgeVerdict[]
    readonly truncated?: boolean
  } = {},
): StepOutcome => {
  const landing = snapshot.landing
  if (landing.kind === "refusal") return { kind: "refusal", message: landing.message }
  if (landing.kind === "noop") {
    return { kind: "noop", state: snapshot.state, settled: landing.settled }
  }
  const cost =
    opts.cost === undefined
      ? {}
      : { cost: { cost: opts.cost, ...(opts.model !== undefined ? { model: opts.model } : {}) } }
  if (landing.kind === "attempt") {
    const message = formatCommitMessage({ actor: snapshot.actor, to: snapshot.state, ...cost })
    return {
      kind: "commit",
      state: snapshot.state,
      to: snapshot.state,
      subject: landing.subject,
      steps: [
        { kind: "gitWrite", write: { kind: "commitAll", message } },
        { kind: "outcome", outcome: { kind: "commit", subject: landing.subject } },
      ],
    }
  }
  const message = formatCommitMessage({
    ...landing.spec,
    ...cost,
    ...(opts.judge !== undefined && opts.judge.length > 0 ? { judge: opts.judge } : {}),
    ...(opts.truncated === true ? { truncated: true } : {}),
  })
  const subject = message.split("\n")[0]!
  const outcome: LandStep =
    landing.to === snapshot.state
      ? { kind: "outcome", outcome: { kind: "commit", subject } }
      : { kind: "outcome", outcome: { kind: "transition", from: snapshot.state, to: landing.to } }
  return {
    kind: "commit",
    state: snapshot.state,
    to: landing.to,
    subject,
    steps: [
      ...uncheckStep(snapshot),
      { kind: "gitWrite", write: { kind: "commitAll", message } },
      outcome,
    ],
  }
}
