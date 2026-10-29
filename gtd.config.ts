// Every exported workflow is startable with `gtd start <name>`; the
// default export is what a change in the tree starts. The workflows come from
// a pinned checkout of pmelab/gtd-workflows on this machine (`gtd-wf pin`);
// the path is absolute, so another machine needs its checkout at the same place.
import type { GtdConfig } from "@pmelab/gtd/flows"
import {
  feature as shippedFeature,
  review as shippedReview,
  fix as shippedFix,
  rollout as shippedRollout,
  cleanup as shippedCleanup,
} from "/Users/pmelab/.local/share/gtd/workflows/dist/default.mjs"

// The default lenses minus owasp-security.
const qualityReviews = "correctness, ponytail-review, test-audit, conventions, spec-challenge"

export const feature = shippedFeature({ qualityReviews })
export const review = shippedReview({ qualityReviews })
export const fix = shippedFix({ qualityReviews })
export const rollout = shippedRollout()
export const cleanup = shippedCleanup()
export default feature

const format = 'npx oxfmt --no-error-on-unmatched-pattern --write "$GTD_FILE"'

// `satisfies` rather than `defineConfig`: a type import is erased, so a gtd
// older than `defineConfig` can still load this file while it drives this repo.
export const config = {
  modes: {
    qa: { format, validate: 'node ./dist/gtd.bundle.mjs check qa "$GTD_FILE"' },
    review: { format, validate: 'node ./dist/gtd.bundle.mjs check review "$GTD_FILE"' },
    findings: { format, validate: 'node ./dist/gtd.bundle.mjs check findings "$GTD_FILE"' },
  },
  ui: { format },
} satisfies GtdConfig
