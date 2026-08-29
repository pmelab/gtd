// `packages.item.building`'s grader: the shared core only — this case
// declares no `artifact`, so there is nothing state-specific to add.
import spec from "../cases/packages-item-building.mjs"
import { SHARED_CHECKS, runChecks } from "./shared.mjs"

export default function grade(output, context) {
  const result = JSON.parse(output)
  return runChecks(SHARED_CHECKS, result, spec, context.vars.variant)
}
