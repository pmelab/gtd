// `packages.item.building`'s grader: the shared core only — this case
// declares no `artifact`, so there is nothing state-specific to add.
import spec from "../cases/packages-item-building.mjs"
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"

export default function grade(output, context) {
  return safeGrade(output, context, spec, SHARED_CHECKS)
}
