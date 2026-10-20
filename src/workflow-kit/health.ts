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

export interface Health {
  /** One counted run of the suite; resolves `true` when green. */
  readonly check: () => Promise<boolean>
  /** Where `check` leaves a red run's output. */
  readonly report: string
  readonly fixCap: number
  readonly fixesSoFar?: number
  /** Whether two consecutive red reports are the same failure; `true` escalates at once. */
  readonly sameFailure: (previous: string, current: string) => Promise<boolean>
  /** Shared with other callers in the same run of red checks. */
  readonly escalations: EscalationCount
  readonly escalation: EscalationSteps
  /** Runs the suite once more before a person is asked; `true` ends the loop as if `check` had passed. */
  readonly recheck?: () => Promise<boolean>
}

// check() stamps the report with the commit it ran at, so equal failures differ there.
const STAMP = /\n<!-- gtd check [0-9a-f]+ -->\n?$/
const stripStamp = (text: string): string => text.replace(STAMP, "\n")

/**
 * Loop until the suite is green: check, and on red run `fix` — escalating
 * first once `fixCap` fixes are spent, or `sameFailure` calls the failure
 * identical to the previous round's, unless `recheck` passes.
 */
export const healthy = async (fix: () => Promise<void>, health: Health): Promise<void> => {
  let fixes = health.fixesSoFar ?? 0
  let previous: string | undefined
  for (;;) {
    if (await health.check()) {
      health.escalations.rounds = 0
      return
    }
    const current = stripStamp(read(health.report) ?? "")
    const stuck = previous !== undefined && (await health.sameFailure(previous, current))
    previous = current
    if (stuck || fixes >= health.fixCap) {
      if (health.recheck !== undefined && (await health.recheck())) {
        health.escalations.rounds = 0
        return
      }
      await escalation(health.escalations, health.escalation)
      fixes = 0
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
