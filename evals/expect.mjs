// The one place a turn's changed `.gtd/` paths are compared against a
// case's expectation — `evals/run-turn.mjs`'s `isStructurallyOk` and
// `evals/asserts/shared.mjs`'s `checkGtdFilesChanged` both call this instead
// of each keeping its own `JSON.stringify` equality, which agreed only by
// coincidence.
export function matchGtdFiles(changed, expected) {
  return JSON.stringify(changed) === JSON.stringify(expected)
    ? undefined
    : `gtdFilesChanged was ${JSON.stringify(changed)}, expected ${JSON.stringify(expected)}`
}
