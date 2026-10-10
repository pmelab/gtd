// Zero imports on purpose — a pure, dependency-free vocabulary tier; keep it that way.

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

/** A segment that resolves to no key at all (missing from an object, out-of-range or non-numeric against an array) — distinct from a present key holding `undefined`. */
const NOT_FOUND: unique symbol = Symbol("not-found")

/** An all-digits segment (`"0"`, `"12"`) — the only shape an array segment resolves against. */
const ARRAY_INDEX = /^\d+$/

/**
 * One step of the walk: looks `segment` up on `current`, or reports
 * `NOT_FOUND` for a key that was never there (a primitive has no keys).
 * Against an array, only an all-digits segment resolves — an in-range index
 * (`skills.0` reads the first declared skill), never a non-index own key
 * (`length`/`map`/every other inherited array member stays `NOT_FOUND`).
 * Against an object, presence is an OWN-property test
 * (`Object.prototype.hasOwnProperty`), never the `in` operator — `in` walks
 * the prototype chain, so it would resolve inherited members
 * (`constructor`, `toString`, `hasOwnProperty`, `valueOf`, ...) as real
 * document fields.
 */
const resolveSegment = (current: unknown, segment: string): unknown => {
  if (Array.isArray(current)) {
    return ARRAY_INDEX.test(segment) && Number(segment) < current.length
      ? current[Number(segment)]
      : NOT_FOUND
  }
  if (typeof current === "object" && current !== null) {
    const record = current as Record<string, unknown>
    return Object.prototype.hasOwnProperty.call(record, segment) ? record[segment] : NOT_FOUND
  }
  return NOT_FOUND
}

/**
 * Walks `fields` by dotted key path. Never throws — any unwalkable shape
 * (a primitive mid-path, an out-of-range or non-numeric array segment)
 * degrades to `unknown`, and a present-but-`undefined` value anywhere along
 * the path short-circuits the whole remaining path to `absent` rather than
 * reporting a key that was never actually missing.
 */
export const selectPath = (fields: unknown, path: string): Selection => {
  try {
    let current: unknown = fields
    for (const segment of path.split(".")) {
      current = resolveSegment(current, segment)
      if (current === NOT_FOUND) return { kind: "unknown", path }
      // `null` is treated exactly like `undefined` here: a `null`-typed field
      // (e.g. `BeatDocument.next`, `LandFields.subject`/`cost`/`model`) is a
      // legitimate "nothing here" value, not a value to descend into or print
      // as the literal string "null".
      if (current === undefined || current === null) return { kind: "absent" }
    }
    return toSelection(current)
  } catch {
    return { kind: "unknown", path }
  }
}
