import { Context } from "effect"

const PREFIX = "GTD_"

/** The live release flags as `flag_<name>` settings, provided by the CLI; absent means no flags. */
export class StartFlags extends Context.Reference<StartFlags>()("StartFlags", {
  defaultValue: (): Readonly<Record<string, string>> => ({}),
}) {}

/**
 * One kind of setting, later wins: the workflow's own defaults, `--var`
 * overrides (process settings only; environment settings pass `{}`), then
 * `GTD_<NAME>` for any name an earlier layer declared (a shell variable never
 * introduces a name).
 */
export const resolveVars = (
  workflowVars: Readonly<Record<string, string>>,
  entryVars: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const merged = { ...workflowVars, ...entryVars }
  for (const name of Object.keys(merged)) {
    const key = PREFIX + name.toUpperCase()
    // GTD_FLAG_* belongs to feature flags; a flag_* setting loses its env override.
    if (key.startsWith("GTD_FLAG_")) continue
    const value = env[key]
    if (value !== undefined) merged[name] = value
  }
  return merged
}

/**
 * `resolveVars` for a process being STARTED: `flags` land between the workflow
 * defaults and `--var`, for already-declared names only. A running process never
 * calls this — it replays its pinned record.
 */
export const resolveStartVars = (
  workflowVars: Readonly<Record<string, string>>,
  flags: Readonly<Record<string, string>>,
  entryVars: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const declared = Object.fromEntries(
    Object.entries(flags).filter(([name]) => Object.hasOwn(workflowVars, name)),
  )
  return resolveVars({ ...workflowVars, ...declared }, entryVars, env)
}

/** The first process setting whose value spans lines — a `Gtd-Var:` trailer cannot carry it. */
export const multilineSetting = (vars: Readonly<Record<string, string>>): string | undefined =>
  Object.keys(vars)
    .sort()
    .find((name) => /[\r\n]/.test(vars[name]!))

const SETTING_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A name is written verbatim into a `Gtd-Var: <name>=<value>` trailer, so `=` or a newline would corrupt it. */
export const isSettingName = (name: string): boolean => SETTING_NAME.test(name)

export const SETTING_NAME_RULE = 'a setting name is a letter or "_", then letters, digits or "_"'
