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
