import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { DriverState } from "./DriverState.js"

/** Where the table lives under the driver state dir — see `DriverState.ts`. Same path bash's now-removed table used, so a loop in flight across the upgrade keeps its sessions. */
const SESSION_TABLE_FILE = "gtd-loop-memory"

/**
 * One row of the per-scope session table: the memory key it was minted for,
 * the agent session id remembered against it, and whether a `step` has
 * confirmed the dispatch that minted it (see `resolveSession`/
 * `confirmSession`). `"fresh"` means `next --json` minted this id but no
 * step has landed since — not yet safe to resume. A 2-field legacy row (no
 * status column, written by bash's now-removed table) parses as `"used"`.
 */
export interface SessionRow {
  readonly key: string
  readonly sessionId: string
  readonly status: "fresh" | "used"
}

/**
 * Parses the table's file contents into rows, ignoring blank lines and any
 * malformed one (not 2 or 3 whitespace-separated fields, or a 3rd field
 * other than `"fresh"`/`"used"`) rather than failing — a corrupt or
 * hand-edited table degrades to losing just its bad rows.
 */
export const parseTable = (content: string | undefined): readonly SessionRow[] => {
  if (content === undefined) return []
  const rows: SessionRow[] = []
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue
    const fields = line.split(/\s+/)
    if (fields.length === 2) {
      rows.push({ key: fields[0]!, sessionId: fields[1]!, status: "used" })
    } else if (fields.length === 3 && (fields[2] === "fresh" || fields[2] === "used")) {
      rows.push({ key: fields[0]!, sessionId: fields[1]!, status: fields[2] })
    }
  }
  return rows
}

/** Inverse of `parseTable`: one `<key> <sessionId> <status>` line per row, trailing newline, empty string for zero rows. */
export const formatTable = (rows: readonly SessionRow[]): string =>
  rows.length === 0
    ? ""
    : rows.map((row) => `${row.key} ${row.sessionId} ${row.status}`).join("\n") + "\n"

/** The scope part of a `<scope>#<hash>` memory key: everything before the first `#`, or the whole key when there is none. Rows displace by scope, not by exact key — see `upsertRow`. */
export const scopeOf = (key: string): string => {
  const idx = key.indexOf("#")
  return idx === -1 ? key : key.slice(0, idx)
}

/**
 * Replaces the ONE row whose scope (`scopeOf`) matches `row`'s, leaving
 * every other scope's row untouched — a scope has at most one live
 * conversation at any moment, so an existing row for it is dead the instant
 * a new entry into it begins.
 */
export const upsertRow = (rows: readonly SessionRow[], row: SessionRow): readonly SessionRow[] => {
  const scope = scopeOf(row.key)
  return [...rows.filter((existing) => scopeOf(existing.key) !== scope), row]
}

/**
 * Resolves the session id a `prompt` rest's turn should use, implementing
 * the plan's decisions 2 and 8: no `memoryKey` (a prompt rest whose scope
 * doesn't resolve) mints an EPHEMERAL id and never touches the table —
 * `resume: false`, nothing written, so a driver needs no "did I get a
 * session?" branch. With a `memoryKey`, an exact-key row already `"used"`
 * (a prior `step` confirmed it) is resumed as-is; a miss OR a `"fresh"` row
 * (an earlier, not-yet-confirmed peek — see decision 2, `next --json` may be
 * called more than once per beat) MINTS a new id and writes it back as
 * `"fresh"`, so a peek can never poison a beat with an id nobody dispatched.
 * `mint` defaults to `randomUUID`, overridable for deterministic tests.
 */
export const resolveSession = (
  memoryKey: string | undefined,
  mint: () => string = randomUUID,
): Effect.Effect<{ readonly sessionId: string; readonly resume: boolean }, never, DriverState> =>
  Effect.gen(function* () {
    if (memoryKey === undefined) return { sessionId: mint(), resume: false }
    const state = yield* DriverState
    const rows = parseTable(yield* state.read(SESSION_TABLE_FILE))
    const existing = rows.find((row) => row.key === memoryKey)
    if (existing !== undefined && existing.status === "used") {
      return { sessionId: existing.sessionId, resume: true }
    }
    const sessionId = mint()
    yield* state.write(
      SESSION_TABLE_FILE,
      formatTable(upsertRow(rows, { key: memoryKey, sessionId, status: "fresh" })),
    )
    return { sessionId, resume: false }
  })

/**
 * Promotes `memoryKey`'s row from `"fresh"` to `"used"` once a `step` has
 * confirmed the turn `resolveSession` dispatched it for — a no-op when the
 * row is absent (no `resolveSession` call preceded it, e.g. no memory key)
 * or already `"used"` (nothing to promote).
 */
export const confirmSession = (
  memoryKey: string | undefined,
): Effect.Effect<void, never, DriverState> =>
  Effect.gen(function* () {
    if (memoryKey === undefined) return
    const state = yield* DriverState
    const rows = parseTable(yield* state.read(SESSION_TABLE_FILE))
    const existing = rows.find((row) => row.key === memoryKey)
    if (existing === undefined || existing.status === "used") return
    yield* state.write(
      SESSION_TABLE_FILE,
      formatTable(upsertRow(rows, { ...existing, status: "used" })),
    )
  })
