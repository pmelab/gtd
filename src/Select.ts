// Zero imports on purpose — the same pure tier `src/Sh.ts` sits in; keep it that way.

export type Selection =
  | { readonly kind: "value"; readonly text: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown"; readonly path: string }

/**
 * Renders a fully-walked leaf value: scalars/booleans stringify directly,
 * arrays become one `JSON.stringify` per entry, newline-joined.
 * `selectPath`'s loop already returns `absent` for `undefined`/`null` after
 * every segment (including the last), so neither ever reaches here.
 */
const toSelection = (value: unknown): Selection => {
  if (Array.isArray(value)) {
    return { kind: "value", text: value.map((entry) => JSON.stringify(entry)).join("\n") }
  }
  if (typeof value === "object") {
    return { kind: "value", text: JSON.stringify(value) }
  }
  return { kind: "value", text: String(value) }
}

/** A segment that resolves to no key at all (missing from an object, or numeric/absent against an array) — distinct from a present key holding `undefined`. */
const NOT_FOUND: unique symbol = Symbol("not-found")

/**
 * One step of the walk: looks `segment` up on `current`, or reports
 * `NOT_FOUND` for a key that was never there (no array indexing; a primitive
 * has no keys). Presence is an OWN-property test
 * (`Object.prototype.hasOwnProperty`), never the `in` operator — `in` walks
 * the prototype chain, so it would resolve inherited members
 * (`constructor`, `toString`, `hasOwnProperty`, `valueOf`, ...) as real
 * document fields. An array declares no non-index own key the document ever
 * uses, so every array segment is `NOT_FOUND` (all-digit ones already were;
 * this also now excludes `length`/`map`/every other inherited array member).
 */
const resolveSegment = (current: unknown, segment: string): unknown => {
  if (Array.isArray(current)) return NOT_FOUND
  if (typeof current === "object" && current !== null) {
    const record = current as Record<string, unknown>
    return Object.prototype.hasOwnProperty.call(record, segment) ? record[segment] : NOT_FOUND
  }
  return NOT_FOUND
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
    let current: unknown = fields
    for (const segment of path.split(".")) {
      current = resolveSegment(current, segment)
      if (current === NOT_FOUND) return { kind: "unknown", path }
      // `null` is treated exactly like `undefined` here: a `null`-typed field
      // (e.g. `BeatFields.next`, `LandFields.subject`/`cost`/`model`) is a
      // legitimate "nothing here" value, not a value to descend into or print
      // as the literal string "null".
      if (current === undefined || current === null) return { kind: "absent" }
    }
    return toSelection(current)
  } catch {
    return { kind: "unknown", path }
  }
}
