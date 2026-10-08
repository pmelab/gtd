// `architecture.decompose`'s grader: the shared core (which already grades
// the count-and-shape rule — the expected package files, via `matchGtdFiles`'s
// descriptor branch — through `checkGtdFilesChanged`); `.gtd/ARCHITECTURE.md`
// must survive, so it may not appear among the changed files.
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"
import spec from "../cases/architecture-decompose.mjs"

export default function grade(output, context) {
  return safeGrade(output, context, spec, SHARED_CHECKS)
}
