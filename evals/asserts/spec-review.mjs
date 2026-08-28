// Deterministic graders (tiers 1-2) over the JSON `run-turn.mjs` prints — no
// model, no cost. promptfoo calls a `javascript` assert's default export with
// `(output, context)`; `context.vars.variant` is the fixture variant under
// test (`context.test.vars` per promptfoo's own assert contract).
import spec from "../cases/spec-review.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

function checkGtdFilesChanged(result, variant) {
  const expected = variant === "violation" ? [".gtd/SPEC_FEEDBACK.md"] : []
  if (JSON.stringify(result.gtdFilesChanged) === JSON.stringify(expected)) return undefined
  return fail(
    `gtdFilesChanged was ${JSON.stringify(result.gtdFilesChanged)}, expected ${JSON.stringify(expected)}`,
  )
}

function checkOtherFilesChanged(result) {
  if (result.otherFilesChanged.length === 0) return undefined
  return fail(
    `otherFilesChanged was non-empty: ${JSON.stringify(result.otherFilesChanged)} — the reviewer must never fix anything`,
  )
}

function checkFormatted(result) {
  if (result.unformatted.length === 0) return undefined
  return fail(
    `unformatted .gtd/ files after the fixture's commit hook: ${JSON.stringify(result.unformatted)}`,
  )
}

function checkPlantedIdentifier(result, variant) {
  if (variant !== "violation" || result.feedback.includes(spec.plantedIdentifier)) return undefined
  return fail(
    `feedback did not mention the planted identifier "${spec.plantedIdentifier}" verbatim`,
  )
}

const CHECKS = [
  checkGtdFilesChanged,
  checkOtherFilesChanged,
  checkFormatted,
  checkPlantedIdentifier,
]

// promptfoo calls a `javascript` assert's default export with `(output,
// context)`; `context.vars.variant` is the fixture variant under test.
export default function grade(output, context) {
  const result = JSON.parse(output)
  const variant = context.vars.variant

  for (const check of CHECKS) {
    const failure = check(result, variant)
    if (failure) return failure
  }

  return { pass: true, score: 1, reason: "structural checks and grep floor passed" }
}
