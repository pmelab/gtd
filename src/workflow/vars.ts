const PREFIX = "GTD_"

/**
 * The merged vars, later wins: the workflow's own defaults, `.gtdrc` `vars:`,
 * the process's entry vars, then `GTD_<NAME>` for any name an earlier layer
 * declared (an env var never introduces a name).
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
