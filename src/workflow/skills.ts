import { Effect } from "effect"
import { GtdError } from "../platform/index.js"
import type { WorkflowDefinition } from "./Workflow.js"
import { accessShapeFault } from "../replay/index.js"
import type { ScopeAccess } from "../flows/index.js"
import type { Diagnostic } from "./Diagnostic.js"
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

/** Every `config` key that names no known scope is a load error. */
const checkKeys = (
  configured: Readonly<Record<string, unknown>>,
  origin: string,
  known: readonly string[],
  section: "skills" | "access",
): Effect.Effect<void, GtdError> => {
  const sorted = [...known].sort()
  const diagnostics: Diagnostic[] = Object.keys(configured)
    .filter((key) => !sorted.includes(key))
    .sort()
    .map((key) => ({
      severity: "error" as const,
      path: ["config", section, key],
      message: `"${section}.${key}" is not a scope that runs a turn — known scopes: ${sorted.join(", ")}`,
      origin,
    }))
  return failOnErrors(diagnostics)
}

/**
 * Skill lists for the settings actually in use. `config.skills` keys are
 * judged here, not at config load: only now are the pinned/entry vars known.
 */
export const resolveScopeSkills = (
  def: Pick<WorkflowDefinition, "skills" | "configuredSkills" | "skillsOrigin">,
  vars: Readonly<Record<string, string>>,
): Effect.Effect<Record<string, readonly string[]>, GtdError> =>
  Effect.gen(function* () {
    const skills = yield* Effect.try({
      try: () => checkShape(def.skills(vars)),
      catch: (e) => fail(def.skillsOrigin, e instanceof Error ? e.message : String(e)),
    })
    const known = Object.keys(skills)
    yield* checkKeys(def.configuredSkills, def.skillsOrigin, known, "skills")
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
 * Access for the settings actually in use. A `config.access` key may name
 * any scope the workflow gives skills or access to.
 */
export const resolveScopeAccess = (
  def: Pick<WorkflowDefinition, "access" | "configuredAccess" | "skillsOrigin">,
  skills: Readonly<Record<string, readonly string[]>>,
  vars: Readonly<Record<string, string>>,
): Effect.Effect<Record<string, ScopeAccess>, GtdError> =>
  Effect.gen(function* () {
    const access = yield* Effect.try({
      try: () => checkAccessShape(def.access(vars)),
      catch: (e) => fail(def.skillsOrigin, e instanceof Error ? e.message : String(e)),
    })
    const known = [...new Set([...Object.keys(skills), ...Object.keys(access)])]
    yield* checkKeys(def.configuredAccess, def.skillsOrigin, known, "access")
    return access
  })
