/**
 * One config-compile finding. `path` mirrors the raw config's own JSON shape
 * (e.g. `["machines","design","states","triage","on",0]`) so a user can find
 * exactly where to fix it; `origin` is the file it came from.
 */
export interface Diagnostic {
  readonly severity: "error" | "warning"
  readonly message: string
  readonly path: readonly (string | number)[]
  readonly origin: string
}

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

/** Sort by config path, so a report lists findings in the order of the file's shape. */
export const sortDiagnostics = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  [...diagnostics].sort((a, b) => compareConfigPaths(a.path, b.path))

/** One finding, printable: `<origin>: <path>: <message>` — the structured replacement for the old prose bullet list. */
export const formatDiagnostic = (d: Diagnostic): string => {
  const path = d.path.length > 0 ? d.path.join(".") : "(top level)"
  return `${d.origin}: ${path}: ${d.message}`
}

/** Dedup by `(severity, path, message, origin)`, first occurrence wins. */
export const dedupeDiagnostics = (diagnostics: readonly Diagnostic[]): Diagnostic[] => {
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const d of diagnostics) {
    const key = JSON.stringify([d.severity, d.path, d.message, d.origin])
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out
}
