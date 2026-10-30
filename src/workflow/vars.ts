import { Context } from "effect"

const PREFIX = "GTD_"

/** The live release flags as `flag_<name>` settings, provided by the CLI; absent means no flags. */
export const StartFlags = Context.Reference<Readonly<Record<string, string>>>("StartFlags", {
  defaultValue: () => ({}),
})

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

const FLAG_VALUES: Readonly<Record<string, string>> = { "0": "0", false: "0", "1": "1", true: "1" }

const flagVariable = (setting: string): string =>
  `GTD_FLAG_${setting.slice("flag_".length).toUpperCase()}`

/** The `flag_<name>` settings a workflow declares that gtd's own flags lack: the workflow's own release flags. */
const ownFlags = (
  workflowVars: Readonly<Record<string, string>>,
  flags: Readonly<Record<string, string>>,
): string[] =>
  Object.keys(workflowVars).filter(
    (name) => name.startsWith("flag_") && !Object.hasOwn(flags, name),
  )

/** Why a workflow's own release flag cannot start, if one is set to anything but 1, 0, true or false. */
export const ownFlagRefusal = (
  workflowVars: Readonly<Record<string, string>>,
  flags: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  const bad = ownFlags(workflowVars, flags).find((name) => {
    const raw = env[flagVariable(name)] ?? ""
    return raw !== "" && !Object.hasOwn(FLAG_VALUES, raw.toLowerCase())
  })
  return bad === undefined ? undefined : `${flagVariable(bad)} must be 1, 0, true or false`
}

/**
 * `resolveVars` for a process being STARTED: `flags` land between the workflow
 * defaults and `--var`, for already-declared names only, and so does
 * `GTD_FLAG_<NAME>` for a `flag_<name>` the workflow declares itself. A running
 * process never calls this — it replays its pinned record.
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
  for (const name of ownFlags(workflowVars, flags)) {
    const value = FLAG_VALUES[(env[flagVariable(name)] ?? "").toLowerCase()]
    if (value !== undefined) declared[name] = value
  }
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
