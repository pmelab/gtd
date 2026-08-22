// Zero imports on purpose — the same pure tier `src/StateFields.ts` sits in; keep it that way.

export type ShLeafKind = "scalar" | "bool" | "list"

export type ShShape = { readonly [key: string]: ShLeafKind | ShShape }

/** The runtime values `renderShDocument` walks alongside a `ShShape` — loosely typed on purpose, since the shape (not this type) is what enforces field coverage. */
export type ShRecord = Record<string, unknown>

type ShLeafFor<V> = V extends readonly unknown[]
  ? "list"
  : V extends boolean
    ? "bool"
    : V extends object
      ? ShShapeFor<V>
      : "scalar"

/**
 * Derives a `ShShape` from a value type `T`: strips optionality (`-?`) so
 * **every** key `T` declares needs an entry, and recurses into object-valued
 * keys. A field added to `T` with no matching shape entry is a compile
 * error, not a test gap.
 */
export type ShShapeFor<T> = {
  readonly [K in keyof T]-?: ShLeafFor<NonNullable<T[K]>>
}

/** POSIX single-quote escaping: wraps in `'...'`, replacing embedded `'` with `'\''`. */
export const shQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const isNestedShape = (node: ShLeafKind | ShShape): node is ShShape => typeof node !== "string"

/** Every leaf variable name a shape declares, flattened with `_`, in shape declaration order — the whole `unset` preamble's contents. */
export const shVarNames = (prefix: string, shape: ShShape): readonly string[] => {
  const names: string[] = []
  const walk = (path: string, node: ShShape): void => {
    for (const [key, kind] of Object.entries(node)) {
      const varPath = `${path}_${key}`
      if (isNestedShape(kind)) walk(varPath, kind)
      else names.push(varPath)
    }
  }
  walk(prefix, shape)
  return names
}

/** A TSV cell: absent/null renders empty; every other value is stringified, with any tab/newline flattened to a space so it can't be mistaken for a row/column boundary. */
const shCell = (value: unknown): string => {
  if (value === undefined || value === null) return ""
  return String(value).replace(/[\t\n]/g, " ")
}

/**
 * Renders a list of records as tab-separated rows. Columns are the union of
 * keys across this call's rows, in first-seen order — a different call, even
 * with structurally identical records, can produce a different column order
 * if its rows carry a different subset of optional keys first, so a driver
 * must not hard-code column positions across separate beats.
 */
const renderTsv = (rows: readonly ShRecord[]): string => {
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return rows.map((row) => columns.map((column) => shCell(row[column])).join("\t")).join("\n")
}

/** One leaf's rendered `=value` right-hand side, or `undefined` to emit nothing (false/null/absent scalar, or an empty list). */
const renderLeafValue = (kind: ShLeafKind, value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (kind === "bool") return value === true ? "true" : undefined
  if (kind === "list") {
    const rows = value as readonly ShRecord[]
    return rows.length === 0 ? undefined : shQuote(renderTsv(rows))
  }
  return shQuote(String(value))
}

/**
 * Renders one shell-sourceable document: one `unset` line naming every leaf
 * `shape` declares (so `eval`ing this document is self-contained and no
 * field absent from it can leave a previous document's value standing),
 * then a generic recursive walk assigning each present leaf.
 */
export const renderShDocument = (prefix: string, shape: ShShape, fields: ShRecord): string => {
  const lines: string[] = [`unset ${shVarNames(prefix, shape).join(" ")}`]

  const walk = (path: string, node: ShShape, data: ShRecord | undefined): void => {
    for (const [key, kind] of Object.entries(node)) {
      const varPath = `${path}_${key}`
      const value = data?.[key]
      if (isNestedShape(kind)) {
        walk(varPath, kind, value as ShRecord | undefined)
        continue
      }
      const rhs = renderLeafValue(kind, value)
      if (rhs !== undefined) lines.push(`${varPath}=${rhs}`)
    }
  }

  walk(prefix, shape, fields)
  return lines.join("\n") + "\n"
}
