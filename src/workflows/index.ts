// The `@pmelab/gtd/workflows` entry, built on its own: core never imports it,
// a repository's `gtd.config.ts` does.
import type { Doors, Summary } from "../flows/index.js"
import { feature } from "./feature/feature.js"
import * as t from "./shared/text.js"
import { ARCHITECTURE, REQUIREMENTS, REVIEW } from "./shared/steps.js"

export { threads, type ThreadInfo } from "../flows/index.js"
export { defaults, envDefaults } from "./shared/vars.js"
export { ShippedOptions } from "./shared/options.js"
export { skills } from "./shared/skills.js"
export { access } from "./shared/access.js"
export { agentWithSkills } from "./shared/text.js"
export * from "./shared/steps.js"
export * from "./shared/health.js"
export * from "./shared/scenarios.js"
export {
  closeReview,
  fixQualityFindings,
  handOffReview,
  handOffTail,
  qualityLap,
  REVIEW_ORIG,
  tail,
  type TailPlan,
} from "./shared/tail.js"
export { lensesOf } from "../workflow-kit/index.js"
export * from "./feature/steps.js"
export * from "./feature/planning.js"
export * from "./feature/packages.js"
export { buildTail, type ReviewOutcome } from "./feature/review.js"
export * from "./feature/feature.js"
export { base, review, reviewFlow } from "./review/review.js"
export { fix, fixFlow, fixReviewNotes } from "./fix/fix.js"

export default feature

export const summary: Summary = t.summaryPrompt

export const steering = { [REQUIREMENTS]: "qa", [ARCHITECTURE]: "qa", [REVIEW]: "review" }

/**
 * @deprecated Empty: each shipped workflow builds its own doors, so a config
 * gets `fix` and `review [base]` by exporting `fix` and `review`.
 */
export const doors: Doors = {}
