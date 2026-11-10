import { formatCommitMessage, type JudgeVerdict } from "../replay/index.js"
import type { StateName } from "../workflow/index.js"
import type { GitWrite, LandStep } from "./LandStep.js"
import type { Landing, RepoSnapshot } from "./RepoSnapshot.js"

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
 * Clear ticks at the human review gate, a tick is read-progress. Keep them when
 * the next step is an agent turn: the agent reads them.
 */
const uncheckStep = (snapshot: RepoSnapshot, keepTicks: boolean): readonly LandStep[] =>
  !keepTicks &&
  snapshot.stepDef.actor === "human" &&
  snapshot.stepDef.mode === "review" &&
  snapshot.file !== undefined
    ? [{ kind: "uncheck", file: snapshot.file }]
    : []

const gitWriteOf = (landing: Extract<Landing, { kind: "commit" }>, message: string): GitWrite => {
  if (landing.ship !== undefined) return { kind: "ship", message, ...landing.ship }
  if (landing.only !== undefined) return { kind: "commitPath", path: landing.only, message }
  if (landing.keepTurn !== undefined) return { kind: "keepTurn", ref: landing.keepTurn, message }
  if (landing.spec.approved !== undefined) return { kind: "commitClean", message }
  return { kind: "commitAll", message }
}

const writeIf = (value: string | undefined, write: (value: string) => GitWrite): LandStep[] =>
  value === undefined ? [] : [{ kind: "gitWrite", write: write(value) }]

export const planStep = (
  snapshot: RepoSnapshot,
  opts: {
    readonly cost?: number
    readonly model?: string
    readonly judge?: readonly JudgeVerdict[]
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
  })
  const subject = message.split("\n")[0]!
  const historyRef = landing.keepHistory ?? landing.ship?.historyRef ?? landing.recordedHistory
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
      ...writeIf(landing.startBranch, (branch) => ({ kind: "switchBranch", branch })),
      ...uncheckStep(snapshot, landing.keepTicks === true),
      { kind: "gitWrite", write: gitWriteOf(landing, message) },
      ...writeIf(historyRef, (ref) => ({ kind: "updateRef", ref, target: "HEAD" })),
      ...writeIf(landing.leaveBranch, (branch) => ({ kind: "switchTo", branch })),
      outcome,
      ...(landing.note !== undefined
        ? [{ kind: "outcome", outcome: { kind: "note", text: landing.note } } as const]
        : []),
      ...writeIf(historyRef !== undefined ? landing.pushHistory : undefined, (remote) => ({
        kind: "pushRef",
        remote,
        ref: historyRef!,
      })),
    ],
  }
}
