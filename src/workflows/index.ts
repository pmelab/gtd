// The `@pmelab/gtd/workflows` entry, built on its own: core never imports it,
// a repository's `gtd.config.ts` does.
import type { Doors } from "../flows/index.js"
import { feature } from "./feature/feature.js"

export { threads, type ThreadInfo } from "../flows/index.js"
export * from "./shared/reserved.js"
export { FlagOptions, ShippedOptions } from "./shared/options.js"
export { agentWithSkills } from "./shared/text.js"
export * from "./shared/steps.js"
export * from "./shared/health.js"
export {
  closeReview,
  fixQualityFindings,
  handOffReview,
  handOffTail,
  qualityLap,
  REVIEW_ORIG,
  tail,
} from "./shared/tail.js"
export { lensesOf } from "../workflow-kit/index.js"
export * from "./feature/steps.js"
export * from "./feature/planning.js"
export * from "./feature/packages.js"
export * from "./feature/refactor.js"
export * from "./feature/seam.js"
export { buildTail, type BuildTailOptions, type ReviewOutcome } from "./feature/review.js"
export * from "./feature/feature.js"
export { base, review, reviewFlow } from "./review/review.js"
export { fix, fixFlow, fixReviewNotes } from "./fix/fix.js"
export { rollout, rolloutFlow } from "./rollout/rollout.js"
export { cleanup, cleanupFlow } from "./cleanup/cleanup.js"

export default feature

/**
 * @deprecated Empty: each shipped workflow builds its own doors, so a config
 * gets `fix` and `review [base]` by exporting `fix` and `review`, and
 * `rollout <flag>` and `cleanup <flag>` by exporting `rollout` and `cleanup`.
 */
export const doors: Doors = {}
