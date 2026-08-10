/**
 * The registry of steering-file FORMATS gtd validates itself, in process:
 * `qa` (`src/OpenQuestions.ts`) and `review` (`src/ReviewDoc.ts`) — the pure
 * parsers the LSP also publishes as live diagnostics/outline/actions, which is
 * why they stay in process rather than becoming shell-outs. No Effect, no
 * git, no filesystem: this is one flat lookup table, kept separate from
 * `src/SteeringMode.ts` so `src/PatternConfig.ts` (the compiler) can seed a
 * workflow's `modes:` map with these names without pulling Effect into a
 * module that otherwise imports none.
 */

import { QA_FORMAT } from "./OpenQuestions.js"
import { REVIEW_FORMAT } from "./ReviewDoc.js"
import type { SteeringFormat } from "./SteeringFormat.js"

const STEERING_FORMATS: ReadonlyMap<string, SteeringFormat> = new Map([
  ["qa", QA_FORMAT],
  ["review", REVIEW_FORMAT],
])

/** Every built-in format name, in registry order. */
export const builtInModeNames = (): readonly string[] => [...STEERING_FORMATS.keys()]

/** The built-in `SteeringFormat` named `mode`, or `undefined` when `mode` names no built-in. */
export const steeringFormatFor = (mode: string): SteeringFormat | undefined =>
  STEERING_FORMATS.get(mode)

/**
 * The literal (unrendered) Eta template a workflow compiler seeds as a
 * built-in mode's own `validate:` command — quoted so a file path containing
 * spaces survives `renderModeCommand`'s interpolation.
 */
export const seededValidateCommand = (mode: string): string => `gtd check ${mode} '<%= it.file %>'`

/**
 * True when `command` is EXACTLY `mode`'s own seeded template string — a
 * literal comparison against the declared template, never a rendered
 * command, so recognition doesn't depend on which file the mode is applied
 * to. Lets a later mode resolver tell gtd's own seeding apart from a user's
 * hand-written override of the same mode.
 */
export const isSeededValidateCommand = (mode: string, command: string): boolean =>
  command === seededValidateCommand(mode)
