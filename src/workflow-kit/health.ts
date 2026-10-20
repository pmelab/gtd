import { read, scope } from "../flows/index.js"

/** How many escalation rounds a run of red checks has spent — reset once the suite goes green. */
export interface EscalationCount {
  rounds: number
}

export interface EscalationSteps {
  /** Rounds a person narrows before `exhausted` replaces them. */
  readonly limit: number
  readonly describe: () => Promise<void>
  readonly stop: () => Promise<void>
  readonly exhausted: () => Promise<void>
}

/** Hand a red suite that repeated attempts could not fix to a person, until `limit` rounds are spent. */
export const escalation = async (count: EscalationCount, steps: EscalationSteps): Promise<void> => {
  if (count.rounds >= steps.limit) return steps.exhausted()
  count.rounds++
  await steps.describe()
  await steps.stop()
}

/** Run `check` again while `pending()` holds — a run then does not count — and resolve the first run that does. */
export const untilSettled = async (
  check: () => Promise<boolean>,
  pending: () => boolean,
): Promise<boolean> => {
  for (;;) {
    const green = await check()
    if (!pending()) return green
  }
}

export type RetryVerdict = "identical" | "progress"

export interface Health {
  /** One counted run of the suite; resolves `true` when green. */
  readonly check: () => Promise<boolean>
  /** Where `check` leaves a red run's output. */
  readonly report: string
  readonly fixCap: number
  readonly fixesSoFar?: number
  /** How a red report compares to the previous round's: `identical` escalates at once, `progress` at the cap earns one extra fix. */
  readonly compare: (previous: string, current: string) => Promise<RetryVerdict | undefined>
  /** Shared with other callers in the same run of red checks. */
  readonly escalations: EscalationCount
  readonly escalation: EscalationSteps
  /** Runs the suite once more before a person is asked; `true` ends the loop as if `check` had passed. */
  readonly recheck?: () => Promise<boolean>
}

// check() stamps the report with the commit it ran at, so equal failures differ there.
const STAMP = /\n<!-- gtd check [0-9a-f]+ -->\n?$/
const stripStamp = (text: string): string => text.replace(STAMP, "\n")

/** `true` when the re-check passed, else the red re-check's report — the one the escalation describes. */
const recheckReport = async (health: Health): Promise<true | string | undefined> => {
  if (health.recheck === undefined) return undefined
  return (await health.recheck()) || stripStamp(read(health.report) ?? "")
}

/** Escalate unless the re-check passes: `true` then, else the report the next round compares against. */
const escalated = async (health: Health, current: string): Promise<true | string> => {
  const rechecked = await recheckReport(health)
  if (rechecked === true) {
    health.escalations.rounds = 0
    return true
  }
  await escalation(health.escalations, health.escalation)
  return rechecked ?? current
}

const nextMove = async (
  health: Health,
  fixes: number,
  cap: number,
  previous: string | undefined,
  current: string,
): Promise<"extend" | "escalate" | undefined> => {
  const capped = fixes >= cap
  // Past a raised cap the loop escalates whatever the judge would answer.
  if (capped && cap > health.fixCap) return "escalate"
  const verdict = previous === undefined ? undefined : await health.compare(previous, current)
  if (capped && verdict === "progress") return "extend"
  return verdict === "identical" || capped ? "escalate" : undefined
}

/**
 * Loop until the suite is green: check, and on red run `fix` — escalating
 * first once `fixCap` fixes are spent, or `compare` calls the failure
 * identical to the previous round's, unless `recheck` passes. A round that
 * reaches the cap while `compare` calls it progress raises the cap by one fix,
 * once per run of fixes between escalations.
 */
export const healthy = async (fix: () => Promise<void>, health: Health): Promise<void> => {
  let fixes = health.fixesSoFar ?? 0
  let cap = health.fixCap
  let previous: string | undefined
  for (;;) {
    if (await health.check()) {
      health.escalations.rounds = 0
      return
    }
    const current = stripStamp(read(health.report) ?? "")
    const move = await nextMove(health, fixes, cap, previous, current)
    previous = current
    if (move === "extend") cap++
    else if (move === "escalate") {
      const after = await escalated(health, current)
      if (after === true) return
      previous = after
      fixes = 0
      cap = health.fixCap
    }
    fixes++
    await fix()
  }
}

/** Hold the process in scope `name` until `passes` resolves `true`, resting at `blocked` between tries. */
export const gate = (
  name: string,
  passes: () => Promise<boolean>,
  blocked: () => Promise<void>,
): Promise<void> =>
  scope(name, async () => {
    while (!(await passes())) await blocked()
  })
