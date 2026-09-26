/**
 * One config-compile finding. `path` mirrors the raw config's own JSON shape
 * (e.g. `["machines","design","states","triage","on",0]`) so a user can find
 * exactly where to fix it; `origin` is the layer filepath that declared the
 * value, or `BUILT_IN_ORIGIN` for a finding against gtd's bundled default.
 */
export interface Diagnostic {
  readonly severity: "error" | "warning"
  readonly message: string
  readonly path: readonly (string | number)[]
  readonly origin: string
  /** A source position, for a finding against TypeScript source rather than a config path. */
  readonly line?: number
  readonly column?: number
}

/** The origin stamped on a finding against gtd's bundled default workflow — never a real layer filepath, always sorted last. */
export const BUILT_IN_ORIGIN = "(built-in default)"

const compareSegment = (a: string | number, b: string | number): number => {
  if (typeof a === "number" && typeof b === "number") return a - b
  if (typeof a === "number") return -1
  if (typeof b === "number") return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Element-wise path comparison, numbers ordered numerically so `["on", 2]` precedes `["on", 10]`. */
export const compareConfigPaths = (
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): number => {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const c = compareSegment(a[i]!, b[i]!)
    if (c !== 0) return c
  }
  return a.length - b.length
}

/**
 * Sort by origin first (outermost layer to innermost, per `layerOrder`;
 * `BUILT_IN_ORIGIN` always last), then by config path. `layerOrder` is the
 * list of layer origins, outermost first — the same order `ConfigLayer[]` is
 * given to `compileWorkflow` in.
 */
export const sortDiagnostics = (
  diagnostics: readonly Diagnostic[],
  layerOrder: readonly string[],
): Diagnostic[] => {
  const originRank = (origin: string): number => {
    if (origin === BUILT_IN_ORIGIN) return layerOrder.length + 1
    const i = layerOrder.indexOf(origin)
    return i === -1 ? layerOrder.length : i
  }
  return [...diagnostics].sort((a, b) => {
    const rankDiff = originRank(a.origin) - originRank(b.origin)
    if (rankDiff !== 0) return rankDiff
    return compareConfigPaths(a.path, b.path)
  })
}

/** One finding, printable: `<origin>: <path>: <message>` — the structured replacement for the old prose bullet list. */
export const formatDiagnostic = (d: Diagnostic): string => {
  if (d.line !== undefined) return `${d.origin}:${d.line}:${d.column ?? 1}: ${d.message}`
  const path = d.path.length > 0 ? d.path.join(".") : "(top level)"
  return `${d.origin}: ${path}: ${d.message}`
}

/**
 * Dedup by `(severity, path, message, origin)`, first occurrence wins. A repeat
 * WITHIN one layer collapses to one line, but the same problem in two files
 * stays two lines, because each is a separate edit in a file the user owns.
 */
export const dedupeDiagnostics = (diagnostics: readonly Diagnostic[]): Diagnostic[] => {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const d of diagnostics) {
    const key = JSON.stringify([d.severity, d.path, d.message, d.origin, d.line, d.column])
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out
}
