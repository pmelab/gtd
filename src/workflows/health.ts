import {
  answered,
  check,
  env,
  human,
  judge,
  numeric,
  read,
  scope,
  vars,
  type JudgeQuestion,
} from "../flows/index.js"
import { describeEscalation, escalate, escalationExhausted, ESCALATION, FEEDBACK } from "./steps.js"
import * as t from "./text.js"

/** Fix turns a run of red checks gets before it escalates. */
export const FIX_CAP = 3

/** Run the suite as step `name`; resolves `true` when it passed. A failure is in `.gtd/FEEDBACK.md`. */
export const baseline = (name: string, label = "Checking the baseline"): Promise<boolean> =>
  check(name, env.testCommand ?? "", { report: FEEDBACK, label })

/** How many escalation rounds a run of red checks has spent — reset once the suite goes green. */
export interface EscalationCount {
  rounds: number
}

/**
 * Hand a red suite that repeated attempts could not fix to a person: an
 * agent writes `.gtd/ESCALATION.md`, a human narrows it. From the third round
 * on, the human is told the budget is spent instead.
 */
export const escalation = async (count: EscalationCount): Promise<void> => {
  if (count.rounds >= 2) return escalationExhausted()
  count.rounds++
  await describeEscalation()
  await escalate()
}

const STAMP = /\n<!-- gtd check [0-9a-f]+ -->\n?$/
const stripStamp = (text: string): string => text.replace(STAMP, "\n")

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
  readonly escalations?: EscalationCount
}

/**
 * Loop until the suite is green: check, and on red run `fix` — escalating
 * first once `FIX_CAP` fixes are spent, or a judge calls the failure
 * identical to the previous round's.
 */
export const healthy = async (
  fix: () => Promise<void>,
  options: HealthOptions = {},
): Promise<void> => {
  const escalations = options.escalations ?? { rounds: 0 }
  let fixes = options.fixesSoFar ?? 0
  let previous: string | undefined
  for (;;) {
    const green = await check("health.check", env.testCommand ?? "", {
      report: FEEDBACK,
      label: "Running checks",
      // Swept only on green: an unresolved analysis survives every retry.
      sweepOnGreen: [ESCALATION],
    })
    if (green) {
      escalations.rounds = 0
      return
    }
    const current = stripStamp(read(FEEDBACK) ?? "")
    const stuck = previous !== undefined && (await sameFailure(previous, current))
    previous = current
    if (stuck || fixes >= FIX_CAP) {
      await escalation(escalations)
      fixes = 0
    }
    fixes++
    await fix()
  }
}

/** Hold the process at `<name>.blocked` until the suite is green. */
export const gate = (name: string, message: string): Promise<void> =>
  scope(name, async () => {
    while (!(await baseline("check"))) {
      await human("blocked", { message, label: "Baseline is red", file: FEEDBACK })
    }
  })
