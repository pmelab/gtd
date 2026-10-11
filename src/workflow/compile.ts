import { seededValidateCommand } from "./SteeringFormats.js"
import { BUILT_IN_MODE_NAMES } from "../steering/index.js"
import type { ModeDef } from "./Workflow.js"
import { configProblems, type GtdConfig, type UiSettings } from "../flows/index.js"
import type { Diagnostic } from "./Diagnostic.js"

export interface CompiledConfig {
  /** The built-in modes (qa/review, with gtd's own validators) merged with `config.modes`, per half. */
  readonly modes: Record<string, ModeDef>
  readonly ui?: UiSettings
  readonly skills: Readonly<Record<string, readonly string[]>>
  readonly access: GtdConfig["access"] & {}
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * A `gtd.config.ts` `config` export (or its absence), checked and compiled. A
 * malformed export compiles to nothing beyond the built-in modes, with every
 * problem reported at `origin`.
 */
export const compileConfig = (value: unknown, origin: string): CompiledConfig => {
  const seeded: Record<string, ModeDef> = Object.fromEntries(
    BUILT_IN_MODE_NAMES.map((name) => [name, { validate: seededValidateCommand(name) }]),
  )
  const problems = value === undefined ? [] : configProblems(value)
  if (problems.length > 0) {
    return {
      modes: seeded,
      skills: {},
      access: {},
      diagnostics: problems.map(({ path, message }) => ({
        severity: "error",
        path: ["config", ...path],
        message,
        origin,
      })),
    }
  }
  const config = (value ?? {}) as GtdConfig
  // Per half: a `format:` alone, or a half left `undefined` (an unset
  // `process.env.X`), keeps a built-in mode's own validator.
  const modes = { ...seeded }
  for (const [name, entry] of Object.entries(config.modes ?? {}))
    modes[name] = {
      ...modes[name],
      ...Object.fromEntries(Object.entries(entry).filter(([, command]) => command !== undefined)),
    }
  return {
    modes,
    ...(config.ui !== undefined ? { ui: config.ui } : {}),
    // Null prototype: a `__proto__` key must stay an ordinary (reportable) entry.
    skills: Object.assign(Object.create(null), config.skills),
    access: Object.assign(Object.create(null), config.access),
    diagnostics: [],
  }
}
