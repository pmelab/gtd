// Zero imports on purpose — the same pure tier `src/Sh.ts` sits in; keep it that way.

export type Selection =
  | { readonly kind: "value"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown"; readonly path: string }

const ALL_DIGITS = /^\d+$/

/** Renders a fully-walked leaf value: scalars/booleans/null stringify directly, arrays become one `JSON.stringify` per entry, newline-joined. */
const toSelection = (value: unknown): Selection => {
  if (value === undefined) return { kind: "absent" }
  if (Array.isArray(value)) {
    return { kind: "value", text: value.map((entry) => JSON.stringify(entry)).join("\n") }
  }
  if (typeof value === "object") {
    return { kind: "value", text: JSON.stringify(value) }
  }
  return { kind: "value", text: String(value) }
}

/**
 * Walks `fields` by dotted key path. Never throws — any unwalkable shape
 * (a primitive mid-path, an array indexed by a numeric segment) degrades to
 * `unknown`, and a present-but-`undefined` value anywhere along the path
 * short-circuits the whole remaining path to `absent` rather than reporting
 * a key that was never actually missing.
 */
export const selectPath = (fields: unknown, path: string): Selection => {
  try {
    const segments = path.split(".")
    let current: unknown = fields

    for (const segment of segments) {
      if (Array.isArray(current)) {
        if (ALL_DIGITS.test(segment) || !(segment in current)) {
          return { kind: "unknown", path }
        }
        current = (current as unknown as Record<string, unknown>)[segment]
      } else if (typeof current === "object" && current !== null) {
        const record = current as Record<string, unknown>
        if (!(segment in record)) {
          return { kind: "unknown", path }
        }
        current = record[segment]
      } else {
        return { kind: "unknown", path }
      }

      if (current === undefined) {
        return { kind: "absent" }
      }
    }

    return toSelection(current)
  } catch {
    return { kind: "unknown", path }
  }
}
