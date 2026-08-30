// The one place a turn's changed `.gtd/` paths are compared against a
// case's expectation — `evals/run-turn.mjs`'s `isStructurallyOk` and
// `evals/asserts/shared.mjs`'s `checkGtdFilesChanged` both call this instead
// of each keeping its own `JSON.stringify` equality, which agreed only by
// coincidence.
//
// `expected` is polymorphic: the exact array every case but
// `architecture-decompose` declares, or a descriptor object for a state
// whose turn writes a variable-sized set of paths —
// `{exact: [...], matching: {pattern, count}}`. `exact` paths must all be
// present; every OTHER changed path must match `pattern`, and there must be
// exactly `count` of them.
export function matchGtdFiles(changed, expected) {
  if (Array.isArray(expected)) {
    return JSON.stringify(changed) === JSON.stringify(expected)
      ? undefined
      : `gtdFilesChanged was ${JSON.stringify(changed)}, expected ${JSON.stringify(expected)}`
  }

  if (!expected || !expected.exact) {
    return `gtdFiles descriptor is missing "exact": ${JSON.stringify(expected)}`
  }
  if (!expected.matching) {
    return `gtdFiles descriptor is missing "matching": ${JSON.stringify(expected)}`
  }

  const missingExact = expected.exact.filter((path) => !changed.includes(path))
  if (missingExact.length > 0) {
    return `gtdFilesChanged ${JSON.stringify(changed)} is missing exact path(s) ${JSON.stringify(missingExact)}`
  }

  const remaining = changed.filter((path) => !expected.exact.includes(path))
  if (remaining.length !== expected.matching.count) {
    return `gtdFilesChanged had ${remaining.length} path(s) beyond "exact" (${JSON.stringify(remaining)}), expected ${expected.matching.count} matching ${expected.matching.pattern}`
  }

  const pattern = new RegExp(expected.matching.pattern)
  const notMatching = remaining.filter((path) => !pattern.test(path))
  if (notMatching.length > 0) {
    return `gtdFilesChanged path(s) ${JSON.stringify(notMatching)} do not match pattern ${expected.matching.pattern}`
  }

  return undefined
}
