import type { ScopeAccess } from "../../flows/index.js"
import { lensesOf, lensScopes } from "../../workflow-kit/index.js"

// The bundled workflow's default file access, keyed by scope full name — the
// name a `config.access` entry addresses. Only planning and review scopes
// are restricted, and only on writes; no scope restricts reads. `refactor`'s
// write restriction lives in its own `scope()` option, not here. A step's own
// steering file is folded in per step, so it is not listed here. Build and fix
// scopes carry no entry: no project layout is assumed.
export const access = (
  vars: Readonly<Record<string, string>>,
): Readonly<Record<string, ScopeAccess>> => ({
  design: { write: [] },
  architecture: { write: [".gtd/REQUIREMENTS.md"] },
  "architecture.decompose": { write: [".gtd/packages/**", ".gtd/ARCHITECTURE.md"] },
  "build.review": { write: [".gtd/REVIEW.md"] },
  "build.review.defer": { write: [".gtd/TODO.md"] },
  // `{}` reopens what `build.review` restricted: the fixes edit code.
  "build.review.fix.nits": {},
  "build.review.fix.risks": {},
  ...lensScopes("build.quality", lensesOf(vars.qualityReviews ?? ""), () => ({ write: [] })),
})
