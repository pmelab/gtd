/**
 * The whole `--sh` wire format: escaping, key flattening, and the `unset`
 * preamble, property-tested once here and reused by every structured
 * document that wants a shell-sourceable encoding (today, only
 * `src/Beat.ts`'s `renderBeatSh`). Pure, zero imports — the same tier
 * `src/StateFields.ts` sits in.
 *
 * A document is a nested `ShShape` (a static description of which leaves
 * exist and what kind each is) walked alongside a matching `ShRecord` of
 * actual values. The walk is generic — there is no per-field emission list,
 * so a field can't reach the rendered output without a shape entry, and
 * `ShShapeFor<T>` (below) makes omitting one a compile error rather than a
 * silent gap.
 */

/** One shape leaf's kind: a plain scalar, a boolean flag, or a list of records rendered as TSV. */
export type ShLeafKind = "scalar" | "bool" | "list"

/** A nested record of key -> leaf kind or a further nested shape — the static description `renderShDocument` walks. */
export type ShShape = { readonly [key: string]: ShLeafKind | ShShape }

/** The runtime values `renderShDocument` walks alongside a `ShShape` — loosely typed on purpose, since the shape (not this type) is what enforces field coverage. */
export type ShRecord = Record<string, unknown>

/** One `ShShapeFor<T>` leaf: array -> list, boolean -> bool, nested object -> a nested shape, anything else -> scalar. */
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

/**
 * POSIX single-quote escaping, total over every string: wrap in `'...'`,
 * replacing every embedded `'` with `'\''` (close quote, escaped literal
 * quote, reopen quote). One rule for every field — no per-field special
 * case.
 */
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
 * Renders a list of records as tab-separated rows, one per line. Columns are
 * POSITIONAL, derived from the UNION of keys across every row in first-seen
 * order — never per-row — so an optional key present on only some rows still
 * lines up under `while IFS= read -r` **within this one rendered list**. A
 * key absent from a given row (or present but `null`) renders as an empty
 * column.
 *
 * The guarantee stops at this list's own boundary: because the column order
 * is derived from THIS CALL's data rather than from a fixed per-key schema,
 * two lists of structurally-identical records can render DIFFERENT column
 * orders across separate beats if their first rows happen to carry a
 * different subset of optional keys — e.g. one `edges` list whose first row
 * has `action` but no `describe` renders `pattern target action describe`,
 * while another whose first row has `describe` but no `action` renders
 * `pattern target describe action`. A driver that pins column positions once
 * (e.g. hard-codes `while IFS= read -r pattern target describe action`) is
 * only safe against a beat whose column order it has actually checked — the
 * position of a given optional key is per-beat, never fixed by the
 * originating type's (e.g. `TemplateEdge`'s) declared field order.
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

/** One leaf's rendered `=value` right-hand side, or `undefined` when nothing should be emitted for it (see `renderShDocument`'s table). */
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
 *
 * | value                     | emitted                                   |
 * | ------------------------- | ------------------------------------------ |
 * | string / number           | `<name>='<escaped>'`                       |
 * | `true`                    | `<name>=true`                              |
 * | `false` / `null` / absent | nothing                                    |
 * | nested object             | recurse, path joined with `_`              |
 * | empty array               | nothing                                    |
 * | array of records          | one `<name>` holding TSV rows, `\n`-joined |
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
