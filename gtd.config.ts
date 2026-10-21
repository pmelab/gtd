// Every exported function is startable with `gtd --workflow <name>`; the
// default export is what a change in the tree starts.
import type { GtdConfig } from "@pmelab/gtd/flows"
import {
  feature as shippedFeature,
  review as shippedReview,
  fix as shippedFix,
  rollout as shippedRollout,
  cleanup as shippedCleanup,
} from "@pmelab/gtd/workflows"

// The default lenses minus owasp-security.
const qualityReviews = "correctness, ponytail-review, test-audit, conventions, spec-challenge"

// No release flags for now: no seam judge, no refactor path.
export const feature = shippedFeature({ flagMode: false, qualityReviews })
export const review = shippedReview({ qualityReviews })
export const fix = shippedFix({ qualityReviews })
export const rollout = shippedRollout()
export const cleanup = shippedCleanup()
export default feature

export {
  defaults,
  envDefaults,
  summary,
  base,
  steering,
  skills,
  access,
  doors,
} from "@pmelab/gtd/workflows"

const format = 'npx oxfmt --no-error-on-unmatched-pattern --write "$GTD_FILE"'

// `satisfies` rather than `defineConfig`: a type import is erased, so a gtd
// older than `defineConfig` can still load this file while it drives this repo.
export const config = {
  modes: {
    qa: { format, validate: 'node ./dist/gtd.bundle.mjs check qa "$GTD_FILE"' },
    review: { format, validate: 'node ./dist/gtd.bundle.mjs check review "$GTD_FILE"' },
  },
  ui: { format },
} satisfies GtdConfig
