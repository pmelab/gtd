const PREFIX = "GTD_"

/**
 * One kind of setting, later wins: the workflow's own defaults, the `.gtdrc`
 * map (`vars:` or `env:`), `--var` overrides (process settings only; environment
 * settings pass `{}`), then `GTD_<NAME>` for any name an earlier layer declared
 * (a shell variable never introduces a name).
 */
export const resolveVars = (
  workflowVars: Readonly<Record<string, string>>,
  rcVars: Readonly<Record<string, string>>,
  entryVars: Readonly<Record<string, string>>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const merged = { ...workflowVars, ...rcVars, ...entryVars }
  for (const name of Object.keys(merged)) {
    const value = env[PREFIX + name.toUpperCase()]
    if (value !== undefined) merged[name] = value
  }
  return merged
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
