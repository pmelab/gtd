import { configProblems, type GtdConfig, type UiSettings } from "../flows/internal.js"
import type { Diagnostic } from "./Diagnostic.js"

export interface CompiledConfig {
  readonly ui?: UiSettings
  readonly historyRemote?: string
  readonly skills: Readonly<Record<string, readonly string[]>>
  readonly access: GtdConfig["access"] & {}
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * A `gtd.config.ts` `config` export (or its absence), checked and compiled. A
 * malformed export compiles to nothing, with every problem reported at
 * `origin`.
 */
export const compileConfig = (value: unknown, origin: string): CompiledConfig => {
  const problems = value === undefined ? [] : configProblems(value)
  if (problems.length > 0) {
    return {
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
  return {
    ...(config.ui !== undefined ? { ui: config.ui } : {}),
    ...(config.historyRemote !== undefined ? { historyRemote: config.historyRemote } : {}),
    // Null prototype: a `__proto__` key must stay an ordinary (reportable) entry.
    skills: Object.assign(Object.create(null), config.skills),
    access: Object.assign(Object.create(null), config.access),
    diagnostics: [],
  }
}
