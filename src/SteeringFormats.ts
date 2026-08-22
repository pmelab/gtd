import { QA_FORMAT } from "./OpenQuestions.js"
import { REVIEW_FORMAT } from "./ReviewDoc.js"
import type { SteeringFormat } from "./SteeringFormat.js"

const STEERING_FORMATS: ReadonlyMap<string, SteeringFormat> = new Map([
  ["qa", QA_FORMAT],
  ["review", REVIEW_FORMAT],
])

/** Every built-in format name, in registry order. */
export const builtInModeNames = (): readonly string[] => [...STEERING_FORMATS.keys()]

export const steeringFormatFor = (mode: string): SteeringFormat | undefined =>
  STEERING_FORMATS.get(mode)

/** The unrendered `validate:` template a workflow compiler seeds for a built-in mode — quoted so a path with spaces survives interpolation. */
export const seededValidateCommand = (mode: string): string => `gtd check ${mode} '<%= it.file %>'`

/** True when `command` is exactly `mode`'s seeded template (compared literally, not rendered) — distinguishes gtd's own seeding from a user override. */
export const isSeededValidateCommand = (mode: string, command: string): boolean =>
  command === seededValidateCommand(mode)
