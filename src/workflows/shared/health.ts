import {
  answered,
  check,
  env,
  human,
  judge,
  numeric,
  vars,
  type JudgeQuestion,
} from "../../flows/index.js"
import * as kit from "../../workflow-kit/index.js"
import { describeEscalation, escalate, escalationExhausted, ESCALATION, FEEDBACK } from "./steps.js"
import * as t from "./text.js"

/** Fix turns a run of red checks gets before it escalates. */
export const FIX_CAP = 3

/** Run the suite as step `name`; resolves `true` when it passed. A failure is in `.gtd/FEEDBACK.md`. */
export const baseline = (name: string, label = "Checking the baseline"): Promise<boolean> =>
  check(name, env.testCommand ?? "", { report: FEEDBACK, label })

export type { EscalationCount } from "../../workflow-kit/index.js"

const escalationSteps = (rules?: string): kit.EscalationSteps => ({
  limit: 2,
  describe: () => describeEscalation(rules),
  stop: escalate,
  exhausted: escalationExhausted,
})

/** Runs after an agent or human turn; refuses it by throwing (`refuse`). */
export type Guard = () => void

export const guarded =
  <A extends unknown[]>(turn: (...a: A) => Promise<void>, guard?: Guard) =>
  async (...a: A): Promise<void> => {
    await turn(...a)
    guard?.()
  }

const guardedSteps = (
  guard?: Guard,
  describeGuard?: Guard,
  rests = true,
  rules?: string,
): kit.EscalationSteps => {
  const steps = escalationSteps(rules)
  return {
    limit: steps.limit,
    describe: guarded(guarded(steps.describe, guard), describeGuard),
    stop: guarded(steps.stop, rests ? guard : undefined),
    exhausted: guarded(steps.exhausted, rests ? guard : undefined),
  }
}

/**
 * Hand a red suite that repeated attempts could not fix to a person: an
 * agent writes `.gtd/ESCALATION.md`, a human narrows it. From the third round
 * on, the human is told the budget is spent instead.
 */
export const escalation = (
  count: kit.EscalationCount,
  guard?: Guard,
  guardRests = true,
  rules?: string,
): Promise<void> => kit.escalation(count, guardedSteps(guard, undefined, guardRests, rules))

/** "Is this red round the same failure as the last one?" — asked of two reports, or of nothing when one is empty. */
export const retryQuestion = (comparable: boolean): JudgeQuestion =>
  comparable
    ? {
        id: "verdict",
        primitive: "choice",
        instructions:
          "Compare this round's failing check output (current) against the previous round's (previous), both in state. Classify the change.",
        criteria:
          "identical: the same failure restated, byte-for-byte or the same root cause — the trailing `<!-- gtd check <sha> -->` stamp is already stripped from both, but ignore it too if it ever reappears. new-failure: a materially different symptom than previous. progress: still red, but measurably closer to green (fewer failures, a later stage reached).",
      }
    : {
        id: "verdict",
        primitive: "choice",
        instructions:
          "state carries tailsNotComparable: one of the two check reports came back empty. There is nothing to compare here; answer from criteria alone. `identical` is FORBIDDEN here.",
        criteria:
          "new-failure: a materially different failure than before. progress: still red, but closer to green — the default if genuinely unsure.",
      }

const sameFailure = async (previous: string, current: string): Promise<boolean> => {
  const comparable = current.trim() !== "" && previous.trim() !== ""
  const { answers, truncated } = await judge("health.judge", {
    questions: [retryQuestion(comparable)],
    evidence: comparable ? { current, previous } : { tailsNotComparable: "true" },
    message: t.healthJudgeMessage(),
    label: "Judging the retry",
  })
  // Evidence the budget cut can make two different reports look alike: never sameness.
  return (
    comparable &&
    truncated.length === 0 &&
    answered(answers.verdict, "identical", numeric(vars.judgeIdenticalMinP, Infinity))
  )
}

export interface HealthOptions {
  /** Fix turns already spent before this call. */
  readonly fixesSoFar?: number
  /** Escalation rounds shared with other callers in the same run of red checks. */
  readonly escalations?: kit.EscalationCount
  /** Paths removed on a green run. */
  readonly sweepOnGreen?: readonly string[]
  /** Runs after every fix and escalation turn. */
  readonly guard?: Guard | undefined
  /** Runs after the escalation's agent turn only; the human rests stay unguarded. */
  readonly describeGuard?: Guard | undefined
  /** `false`: `guard` skips the human rests `health.stop` and `health.exhausted`. */
  readonly guardRests?: boolean | undefined
  /** Appended to the escalation's describe prompt. */
  readonly rules?: string | undefined
}

const runSuite = (options: HealthOptions): Promise<boolean> =>
  check("health.check", env.testCommand ?? "", {
    report: FEEDBACK,
    label: "Running checks",
    // Swept only on green: an unresolved analysis survives every retry.
    sweepOnGreen: [ESCALATION, ...(options.sweepOnGreen ?? [])],
  })

/**
 * Loop until the suite is green: check, and on red run `fix` — escalating
 * first once `FIX_CAP` fixes are spent, or a judge calls the failure
 * identical to the previous round's.
 */
export const healthy = (fix: () => Promise<void>, options: HealthOptions = {}): Promise<void> =>
  kit.healthy(guarded(fix, options.guard), {
    check: () => runSuite(options),
    report: FEEDBACK,
    fixCap: FIX_CAP,
    fixesSoFar: options.fixesSoFar ?? 0,
    sameFailure,
    escalations: options.escalations ?? { rounds: 0 },
    escalation: guardedSteps(
      options.guard,
      options.describeGuard,
      options.guardRests,
      options.rules,
    ),
  })

/**
 * Hold the process at `<name>.blocked` until the suite is green. `guard` runs
 * after each `blocked` landing only — never after a check, whose refusal would
 * re-run the same script forever.
 */
export const gate = (name: string, message: string, guard?: Guard): Promise<void> =>
  kit.gate(
    name,
    () => baseline("check"),
    guarded(() => human("blocked", { message, label: "Baseline is red", file: FEEDBACK }), guard),
  )
