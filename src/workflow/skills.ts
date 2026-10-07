import { Effect } from "effect"
import { GtdError } from "../Commentary.js"
import type { WorkflowDefinition } from "../Workflow.js"
import { unknownSkillsKeyMessage } from "./compile.js"
import { dedupeDiagnostics, sortDiagnostics, type Diagnostic } from "./Diagnostic.js"
import { failOnErrors } from "./load.js"

const fail = (origin: string, message: string): GtdError =>
  new GtdError(`gtd config:\n  - ${origin}: ${message}`)

const checkShape = (value: unknown): Record<string, readonly string[]> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("skills export must return an object of scope -> skill names")
  }
  for (const [scope, names] of Object.entries(value)) {
    if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) {
      throw new Error(`skills export: "${scope}" must be an array of skill names`)
    }
  }
  return value as Record<string, readonly string[]>
}

/**
 * Skill lists for the settings actually in use. `.gtdrc` `skills:` keys are
 * judged here, not at config load: only now are the pinned/entry vars known.
 */
export const resolveScopeSkills = (
  def: Pick<WorkflowDefinition, "skills" | "skillsKeys" | "skillsOrigin">,
  vars: Readonly<Record<string, string>>,
): Effect.Effect<Record<string, readonly string[]>, GtdError> =>
  Effect.gen(function* () {
    const skills = yield* Effect.try({
      try: () => checkShape(def.skills(vars)),
      catch: (e) => fail(def.skillsOrigin, e instanceof Error ? e.message : String(e)),
    })
    const known = Object.keys(skills).sort()
    const diagnostics: Diagnostic[] = def.skillsKeys
      .filter(({ key }) => !known.includes(key))
      .map(({ key, origin }) => ({
        severity: "error" as const,
        path: ["skills", key],
        message: unknownSkillsKeyMessage(key, known),
        origin,
      }))
    yield* failOnErrors(
      dedupeDiagnostics(
        sortDiagnostics(diagnostics, [...new Set(def.skillsKeys.map((k) => k.origin))]),
      ),
    )
    return skills
  })
