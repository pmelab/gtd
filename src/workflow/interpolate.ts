import type { Diagnostic } from "./Diagnostic.js"

const VAR_PATTERN = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * `modes.*.format`, `modes.*.validate` and `ui.format` — gtd hands these
 * straight to bash, where `$` already means the shell's own expansion. The
 * predicate reads only the config PATH shape, never the value: sniffing for
 * `$GTD_FILE` would exempt whichever command happens not to name it, and
 * silently interpolate one that names something else instead.
 */
export const isBashExemptPath = (path: readonly (string | number)[]): boolean => {
  if (path.length === 3 && path[0] === "modes" && (path[2] === "format" || path[2] === "validate"))
    return true
  if (path.length === 2 && path[0] === "ui" && path[1] === "format") return true
  return false
}

const interpolateString = (
  value: string,
  path: readonly (string | number)[],
  env: Readonly<Record<string, string | undefined>>,
  diagnostics: Diagnostic[],
): string =>
  value.replace(VAR_PATTERN, (match: string, braced?: string, bare?: string) => {
    if (match === "$$") return "$"
    const name = braced ?? bare
    if (name === undefined) return match
    const resolved = env[name]
    if (resolved !== undefined) return resolved
    diagnostics.push({
      severity: "error",
      path,
      message: `"${match}" references environment variable "${name}", which is not set`,
      origin: "",
    })
    return match
  })

const walk = (
  value: unknown,
  path: readonly (string | number)[],
  env: Readonly<Record<string, string | undefined>>,
  diagnostics: Diagnostic[],
): unknown => {
  if (typeof value === "string") {
    return isBashExemptPath(path) ? value : interpolateString(value, path, env, diagnostics)
  }
  if (Array.isArray(value)) return value.map((v, i) => walk(v, [...path, i], env, diagnostics))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value))
      out[key] = walk(v, [...path, key], env, diagnostics)
    return out
  }
  return value
}

/**
 * Expand `$NAME`/`${NAME}` from `env` over every string leaf of a decoded
 * `.gtdrc` layer, except the three paths gtd hands to bash. `$$` yields a
 * literal `$`; any other `$` not followed by a valid name (a trailing `$`,
 * `$1`, `$-`, `$ `) is left untouched. Exactly one pass: `String.replace`
 * never rescans a replacement's own text, so an environment variable's value
 * can never be read back as config syntax. An unset name is a load-error
 * `Diagnostic` naming the config path; the original `$NAME` text is left in
 * place rather than blanked.
 */
export const interpolate = (
  config: unknown,
  env: Readonly<Record<string, string | undefined>>,
): { readonly value: unknown; readonly diagnostics: readonly Diagnostic[] } => {
  const diagnostics: Diagnostic[] = []
  const value = walk(config, [], env, diagnostics)
  return { value, diagnostics }
}
