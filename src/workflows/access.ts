import type { ScopeAccess } from "../flows/index.js"
import { lensesOf } from "./review.js"

// The bundled workflow's default file access, keyed by scope full name — the
// name a `.gtdrc` `access:` entry addresses. Only planning and review scopes
// are restricted, and only on writes; no scope restricts reads. A step's own
// steering file is folded in per step, so it is not listed here. Build and fix
// scopes carry no entry: no project layout is assumed.
export const access = (
  vars: Readonly<Record<string, string>>,
): Readonly<Record<string, ScopeAccess>> => ({
  design: { write: [] },
  architecture: { write: [".gtd/REQUIREMENTS.md"] },
  "architecture.decompose": { write: [".gtd/packages/**", ".gtd/ARCHITECTURE.md"] },
  "build.review": { write: [".gtd/REVIEW.md"] },
  // `{}` reopens what `build.review` restricted: the fixes edit code.
  "build.review.fix.nits": {},
  "build.review.fix.risks": {},
  ...Object.fromEntries(
    lensesOf(vars.qualityReviews ?? "").map((lens) => [`build.quality.${lens}`, { write: [] }]),
  ),
})
