import { globMatches } from "../wire/index.js"

/** Globs use the `access.write` dialect (`globMatches`). */
export const strayPaths = (
  touched: ReadonlyArray<string>,
  allow: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  touched.filter((path) => !allow.some((glob) => globMatches(path, glob))).sort()
