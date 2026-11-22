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

/** A steering file lands in its canonical form. */
const formatStep = (snapshot: RepoSnapshot): readonly LandStep[] =>
  snapshot.file !== undefined ? [{ kind: "format", file: snapshot.file }] : []

const gitWriteOf = (landing: Extract<Landing, { kind: "commit" }>, message: string): GitWrite => {
  if (landing.ship !== undefined) return { kind: "ship", message, ...landing.ship }
  if (landing.only !== undefined) return { kind: "commitPath", path: landing.only, message }
  if (landing.keepTurn !== undefined) return { kind: "keepTurn", ref: landing.keepTurn, message }
  if (landing.spec.approved !== undefined) return { kind: "commitClean", message }
  if (landing.spec.actor === "check") return { kind: "commitAll", message, exit: true }
  return { kind: "commitAll", message }
}

const writeIf = (value: string | undefined, write: (value: string) => GitWrite): LandStep[] =>
  value === undefined ? [] : [{ kind: "gitWrite", write: write(value) }]

type CostPart = {
  readonly cost?: { readonly cost: number; readonly model?: string }
  readonly duration?: number
}
type Attempt = Extract<Landing, { kind: "attempt" }>
type Committed = Extract<Landing, { kind: "commit" }>

const planAttempt = (snapshot: RepoSnapshot, landing: Attempt, cost: CostPart): StepOutcome => {
  const message = formatCommitMessage({ actor: snapshot.actor, to: snapshot.state, ...cost })
  return {
    kind: "commit",
    state: snapshot.state,
    to: snapshot.state,
    subject: landing.subject,
    steps: [
      ...formatStep(snapshot),
      ...writeIf(landing.discard, () => ({ kind: "discardPending" })),
      {
        kind: "gitWrite",
        write: {
          kind: "commitAll",
          message,
          ...(snapshot.actor === "check" ? { exit: true as const } : {}),
        },
      },
      // Every retry of a carried step starts on the earlier pass.
      ...writeIf(landing.discard, (hash) => ({ kind: "carryPass", hash })),
      { kind: "outcome", outcome: { kind: "commit", subject: landing.subject } },
    ],
  }
}

const planCommit = (
  snapshot: RepoSnapshot,
  landing: Committed,
  cost: CostPart,
  judge: readonly JudgeVerdict[] | undefined,
): StepOutcome => {
  const message = formatCommitMessage({
    ...landing.spec,
    ...cost,
    ...(judge !== undefined && judge.length > 0 ? { judge } : {}),
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
      ...formatStep(snapshot),
      // A keep landing resets the tree to HEAD before the carry applies, so the check must test HEAD.
      ...writeIf(landing.carryPass, (hash) => ({
        kind: "carryCheck",
        hash,
        ...(landing.keepTurn !== undefined ? { against: "head" as const } : {}),
      })),
      { kind: "gitWrite", write: gitWriteOf(landing, message) },
      ...writeIf(landing.carryPass, (hash) => ({ kind: "carryPass", hash })),
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

export const planStep = (
  snapshot: RepoSnapshot,
  opts: {
    readonly cost?: number
    readonly model?: string
    readonly duration?: number
    readonly judge?: readonly JudgeVerdict[]
  } = {},
): StepOutcome => {
  const landing = snapshot.landing
  if (landing.kind === "refusal") return { kind: "refusal", message: landing.message }
  if (landing.kind === "noop") {
    return { kind: "noop", state: snapshot.state, settled: landing.settled }
  }
  const cost: CostPart = {
    ...(opts.cost === undefined
      ? {}
      : { cost: { cost: opts.cost, ...(opts.model !== undefined ? { model: opts.model } : {}) } }),
    ...(opts.duration !== undefined ? { duration: opts.duration } : {}),
  }
  if (landing.kind === "attempt") return planAttempt(snapshot, landing, cost)
  return planCommit(snapshot, landing, cost, opts.judge)
}
