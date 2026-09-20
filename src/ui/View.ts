import type { SteeringView } from "../steering/index.js"
import { steeringFormatOrFreeForm } from "../steering/index.js"

/**
 * The phone screen's one dispatch: `mode` → its registered format's own
 * `view(content)`, falling back to the free-form format for an absent or
 * unregistered `mode` — total, never a refusal, since a mode-less/unknown
 * steering file still has bytes to render. The server never imports a format
 * module (`ReviewDoc.ts`, `OpenQuestions.ts`, …) directly and never switches
 * on the mode name, so a user-declared custom mode lights up the phone UI for
 * free the moment it registers a `view` (see `SteeringFormat.ts`'s own doc
 * comment on `view`).
 */
export const steeringViewFor = (mode: string | undefined, content: string): SteeringView =>
  steeringFormatOrFreeForm(mode).view(content)
