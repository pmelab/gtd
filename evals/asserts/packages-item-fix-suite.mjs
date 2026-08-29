// `packages.item.fix-suite`'s grader: the shared core, including
// `checkOutOfBounds` against this case's planted test file.
import spec from "../cases/packages-item-fix-suite.mjs"
import { SHARED_CHECKS, runChecks } from "./shared.mjs"

export default function grade(output, context) {
  const result = JSON.parse(output)
  return runChecks(SHARED_CHECKS, result, spec, context.vars.variant)
}
