import type { SteeringView } from "../SteeringFormat.js"
import { steeringFormatFor } from "../SteeringFormats.js"

/**
 * `steeringViewFor`'s typed refusal — `unsupported-mode` only, mirroring
 * `Write.ts`'s `WriteRefusalReason` naming style: `mode` doesn't resolve to a
 * registered format at all, a config problem, never a parse failure (a
 * format's own `view` is total over `content`).
 */
export type SteeringViewRefusalReason = "unsupported-mode"

export interface SteeringViewRefusal {
  readonly ok: false
  readonly reason: SteeringViewRefusalReason
}

export interface SteeringViewSuccess {
  readonly ok: true
  readonly view: SteeringView
}

export type SteeringViewResult = SteeringViewSuccess | SteeringViewRefusal

/**
 * The phone screen's one dispatch: `mode` → its registered format's own
 * `view(content)` — the server never imports a format module (`ReviewDoc.ts`,
 * `OpenQuestions.ts`, …) directly and never switches on the mode name, so a
 * user-declared custom mode lights up the phone UI for free the moment it
 * registers a `view` (see `SteeringFormat.ts`'s own doc comment on `view`).
 */
export const steeringViewFor = (mode: string, content: string): SteeringViewResult => {
  const format = steeringFormatFor(mode)
  if (format === undefined) return { ok: false, reason: "unsupported-mode" }
  return { ok: true, view: format.view(content) }
}
