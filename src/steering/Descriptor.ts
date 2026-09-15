import type { SteeringFormat } from "./SteeringFormat.js"

/**
 * One steering-file FORMAT's whole behavior: `SteeringFormat` (the public
 * vocabulary every consumer outside this package sees) plus the one
 * capability that must stay format-SPECIFIC and never leak into a
 * general-sounding "unticked" helper: `clearTicks` resets only THIS format's
 * own read-progress ticks. `qa`'s checkbox ticks ARE its answers — never
 * auto-cleared; `review`'s hunk ticks are read-progress, cleared on every
 * land. Both `qa` and `review` (see `qa.ts`/`review.ts`) are exactly one
 * value of this type — `index.ts`'s `clearTicks` dispatches over whichever
 * descriptor a resolved `SteeringFormat` IS (found by reference, never by a
 * mode-name string), so a format can never accidentally run another
 * format's tick-clearing rule.
 */
export interface SteeringDescriptor extends SteeringFormat {
  readonly clearTicks: (content: string) => string
  /**
   * `qa`-only: every OPEN question not yet answered — semantically distinct
   * from `validate`'s structural findings (a well-formed document can still
   * have open questions nobody answered). Absent on `review`, which has no
   * such concept; `index.ts`'s `unansweredQuestions` returns `[]` for a
   * format without this field rather than treating its absence as an error.
   */
  readonly unansweredQuestions?: (content: string) => readonly {
    readonly question: string
    readonly headingLine: number
  }[]
}
