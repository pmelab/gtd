// Case-independent grader checks (tiers 1-2), shared by every
// `evals/asserts/<name>.mjs`. Each check reads `caseDef.expect[variant]`
// (never the variant name itself) so a coder case's "must touch repo code"
// pair coexists with a planner case's "must stay silent" pair under the same
// checks. A grader wires `runChecks(SHARED_CHECKS, ...)` first, then adds
// whatever check is specific to its own state.
const fail = (reason) => ({ pass: false, score: 0, reason })

export function checkGtdFilesChanged(result, caseDef, variant) {
  const expected = caseDef.expect[variant].gtdFiles
  if (JSON.stringify(result.gtdFilesChanged) === JSON.stringify(expected)) return undefined
  return fail(
    `gtdFilesChanged was ${JSON.stringify(result.gtdFilesChanged)}, expected ${JSON.stringify(expected)}`,
  )
}

// "none" is planner shape (must never touch repo code); "required" is coder
// shape (must produce a repo code change) — a coder case that changes
// nothing is the failure here, not the pass.
export function checkOtherFilesChanged(result, caseDef, variant) {
  const mode = caseDef.expect[variant].otherFiles
  if (mode === "none") {
    if (result.otherFilesChanged.length === 0) return undefined
    return fail(
      `otherFilesChanged was non-empty: ${JSON.stringify(result.otherFilesChanged)} — this state must never touch repo code`,
    )
  }
  if (result.otherFilesChanged.length > 0) return undefined
  return fail("otherFilesChanged was empty — this state must produce a repo code change")
}

export function checkFormatted(result) {
  if (result.unformatted.length === 0) return undefined
  return fail(
    `unformatted .gtd/ files after the fixture's commit hook: ${JSON.stringify(result.unformatted)}`,
  )
}

export function checkPlantedIdentifier(result, caseDef, variant) {
  if (variant !== "violation" || !caseDef.plantedIdentifier) return undefined
  if (result.feedback.includes(caseDef.plantedIdentifier)) return undefined
  return fail(
    `feedback did not mention the planted identifier "${caseDef.plantedIdentifier}" verbatim`,
  )
}

// Not one of the four case-independent checks below (those existed before
// this package), but genuinely case-independent once a coder case declares
// `outOfBounds` — the repo-relative path the fixture's obvious wrong move
// would touch. Absent (undefined) on every planner case, where it never
// applies.
export function checkOutOfBounds(result, caseDef) {
  if (!caseDef.outOfBounds) return undefined
  const touched = [...result.gtdFilesChanged, ...result.otherFilesChanged]
  if (!touched.includes(caseDef.outOfBounds)) return undefined
  return fail(`touched the planted out-of-bounds file "${caseDef.outOfBounds}"`)
}

export const SHARED_CHECKS = [
  checkGtdFilesChanged,
  checkOtherFilesChanged,
  checkFormatted,
  checkPlantedIdentifier,
  checkOutOfBounds,
]

// A grader never throws — one bad trial reports a reason instead of killing
// the run — so every check here returns a failing verdict, never throws.
export function runChecks(checks, result, caseDef, variant) {
  for (const check of checks) {
    const failure = check(result, caseDef, variant)
    if (failure) return failure
  }
  return { pass: true, score: 1, reason: "structural checks and grep floor passed" }
}

// Every `evals/asserts/<name>.mjs` calls this instead of parsing `output`
// itself: `run-turn.mjs` exits 1 with plain text on stderr for any
// precondition failure (unknown case, unserved model, agent timeout, oxfmt
// breakage), and a bare `JSON.parse` on that text would throw — killing a
// trial with a parse error instead of a graded failure, in a run where a
// reason matters most. Truncated so one bad trial's raw output doesn't blow
// up the report.
export function safeGrade(output, context, caseDef, checks) {
  let result
  try {
    result = JSON.parse(output)
  } catch (err) {
    const raw = String(output).slice(0, 500)
    return fail(`run-turn.mjs output was not valid JSON (${err.message}): ${raw}`)
  }
  return runChecks(checks, result, caseDef, context.vars.variant)
}
