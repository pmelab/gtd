// The one background slot ship and hand-off share: both push the branch, so
// two at once would race. No global deadline on purpose: a deadline that freed
// the slot while the work still ran would let a second push overwrite the first.

import type { Shipped } from "./ship"
import type { JobName } from "./tools"
import { JOB_NAME } from "./tools"

export type Jobs = {
  // Claims the slot now; `work` starts at once or, `isInTurn`, at the next
  // `flush`. `done` runs when it ends, either way, and owns the job's effect
  // and report. Answers at once: the started text, or a refusal when a job is
  // running or queued.
  start(
    job: JobName,
    work: () => Promise<Shipped>,
    isInTurn: boolean,
    done: (outcome: Shipped) => Promise<void>,
  ): string
  flush(): void
  busy(): JobName | undefined
}

export function jobs(): Jobs {
  let current:
    | {
        job: JobName
        work: () => Promise<Shipped>
        done: (outcome: Shipped) => Promise<void>
        isRunning: boolean
      }
    | undefined

  const launch = () => {
    const slot = current
    if (!slot || slot.isRunning) return
    slot.isRunning = true
    void (async () => {
      let outcome: Shipped
      try {
        outcome = await slot.work()
      } catch (err) {
        outcome = { ok: false, text: err instanceof Error ? err.message : String(err) }
      } finally {
        current = undefined
      }
      try {
        await slot.done(outcome)
      } catch {
        // a failed report must not become an unhandled rejection
      }
    })()
  }

  return {
    start(job, work, isInTurn, done) {
      if (current) {
        return `A ${JOB_NAME[current.job]} is already being prepared; wait for its report.`
      }
      current = { job, work, done, isRunning: false }
      if (!isInTurn) launch()
      return `The ${JOB_NAME[job]} has started in the background; its outcome is reported here when it ends.`
    },
    flush: launch,
    busy: () => current?.job,
  }
}
