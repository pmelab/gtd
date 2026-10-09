import { Effect } from "effect"
import { GtdError } from "../Commentary.js"
import type { WorkflowDefinition } from "../Workflow.js"
import { accessShapeFault } from "../replay/index.js"
import type { ScopeAccess } from "../flows/index.js"
import { unknownAccessKeyMessage, unknownSkillsKeyMessage } from "./compile.js"
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

/** Every `.gtdrc` key that names no known scope is a load error, one per file that wrote it. */
const checkKeys = (
  keys: readonly { readonly key: string; readonly origin: string }[],
  known: readonly string[],
  message: (key: string, known: readonly string[]) => string,
  section: string,
): Effect.Effect<void, GtdError> => {
  const sorted = [...known].sort()
  const diagnostics: Diagnostic[] = keys
    .filter(({ key }) => !sorted.includes(key))
    .map(({ key, origin }) => ({
      severity: "error" as const,
      path: [section, key],
      message: message(key, sorted),
      origin,
    }))
  return failOnErrors(
    dedupeDiagnostics(sortDiagnostics(diagnostics, [...new Set(keys.map((k) => k.origin))])),
  )
}

const knownTo = (
  def: Pick<WorkflowDefinition, "knownScopes">,
  own: readonly string[],
): readonly string[] => [...new Set([...own, ...(def.knownScopes?.() ?? [])])]

/**
 * Skill lists for the settings actually in use. `.gtdrc` `skills:` keys are
 * judged here, not at config load: only now are the pinned/entry vars known.
 */
export const resolveScopeSkills = (
  def: Pick<WorkflowDefinition, "skills" | "skillsKeys" | "skillsOrigin" | "knownScopes">,
  vars: Readonly<Record<string, string>>,
): Effect.Effect<Record<string, readonly string[]>, GtdError> =>
  Effect.gen(function* () {
    const skills = yield* Effect.try({
      try: () => checkShape(def.skills(vars)),
      catch: (e) => fail(def.skillsOrigin, e instanceof Error ? e.message : String(e)),
    })
    const known = knownTo(def, Object.keys(skills))
    yield* checkKeys(def.skillsKeys, known, unknownSkillsKeyMessage, "skills")
    return skills
  })

const checkAccessShape = (value: unknown): Record<string, ScopeAccess> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("access export must return an object of scope -> { read?, write? }")
  }
  for (const [scope, access] of Object.entries(value)) {
    const fault = accessShapeFault(access)
    if (fault !== undefined) throw new Error(`access export: "${scope}": ${fault}`)
  }
  return value as Record<string, ScopeAccess>
}

/**
 * Access for the settings actually in use. A `.gtdrc` `access:` key may name
 * any scope the workflow gives skills or access to.
 */
export const resolveScopeAccess = (
  def: Pick<WorkflowDefinition, "access" | "accessKeys" | "skillsOrigin" | "knownScopes">,
  skills: Readonly<Record<string, readonly string[]>>,
  vars: Readonly<Record<string, string>>,
): Effect.Effect<Record<string, ScopeAccess>, GtdError> =>
  Effect.gen(function* () {
    const access = yield* Effect.try({
      try: () => checkAccessShape(def.access(vars)),
      catch: (e) => fail(def.skillsOrigin, e instanceof Error ? e.message : String(e)),
    })
    const known = knownTo(def, [...Object.keys(skills), ...Object.keys(access)])
    yield* checkKeys(def.accessKeys, known, unknownAccessKeyMessage, "access")
    return access
  })
