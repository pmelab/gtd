// `build.fix`'s grader: the shared core, including `checkOutOfBounds`
// against this case's planted test file.
import spec from "../cases/build-fix.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

export default function grade(output, context) {
  return safeGrade(output, context, spec, SHARED_CHECKS)
}
