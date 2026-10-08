import type { AccessDef, ScopeAccess } from "../flows/index.js"

const UNRESTRICTED: ScopeAccess = {}

const withExtras = (
  globs: readonly string[] | undefined,
  extras: readonly string[],
): readonly string[] | null => (globs === undefined ? null : [...new Set([...globs, ...extras])])

/**
 * Fold a step's own paths into a scope's access: each restricted side gets the
 * steering `file`, then the code threads waiting on the agent. An unrestricted
 * side stays `null`.
 */
export const foldAccess = (
  scopeAccess: ScopeAccess | undefined,
  file: string | undefined,
  threadPaths: readonly string[],
): AccessDef => {
  const access = scopeAccess ?? UNRESTRICTED
  const extras = [...(file === undefined ? [] : [file]), ...threadPaths]
  return { read: withExtras(access.read, extras), write: withExtras(access.write, extras) }
}

/** The shape fault of a `scope()` `access` value, or `undefined` when well-formed. */
export const accessShapeFault = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "access must be an object of { read?, write? } glob arrays"
  }
  for (const [side, globs] of Object.entries(value)) {
    if (side !== "read" && side !== "write") return `unknown access key "${side}"`
    if (globs === undefined) continue
    if (!Array.isArray(globs) || globs.some((g) => typeof g !== "string")) {
      return `access.${side} must be an array of glob strings`
    }
  }
  return undefined
}

const sameGlobs = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.length === b.length && a.every((g, i) => g === b[i])

export const sameAccess = (a: ScopeAccess | undefined, b: ScopeAccess | undefined): boolean =>
  sameGlobs(a?.read, b?.read) && sameGlobs(a?.write, b?.write)
