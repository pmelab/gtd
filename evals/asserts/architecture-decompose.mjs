// `architecture.decompose`'s grader: the shared core (which already grades
// the count-and-shape rule — exactly 3 package files, via `matchGtdFiles`'s
// descriptor branch — through `checkGtdFilesChanged`) plus the one
// state-specific rule the decompose prompt states outright: no package file
// may reference any other `.gtd/` path.
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"
import spec from "../cases/architecture-decompose.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

// `result.packageFiles` is a `{path: content}` map `run-turn.mjs` reads back
// from the landed `.gtd/packages/` directory — `{}` when the directory is
// absent, which this never treats as a failure of its own; the shared
// `gtdFiles` check already fails a turn that wrote none.
function checkNoCrossReference(result) {
  for (const [path, content] of Object.entries(result.packageFiles ?? {})) {
    const match = content.match(/\.gtd\/\S+/)
    if (match) {
      return fail(
        `${path} references another .gtd/ path ("${match[0]}") — package files must reference no other .gtd/ file`,
      )
    }
  }
  return undefined
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [...SHARED_CHECKS, checkNoCrossReference])
}
