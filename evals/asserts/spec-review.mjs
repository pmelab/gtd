// Deterministic grader (tiers 1-2) over the JSON `run-turn.mjs` prints — no
// model, no cost. promptfoo calls a `javascript` assert's default export with
// `(output, context)`; `context.vars.variant` is the fixture variant under
// test (`context.test.vars` per promptfoo's own assert contract).
import spec from "../cases/spec-review.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

export default function grade(output, context) {
  return safeGrade(output, context, spec, SHARED_CHECKS)
}
