# Extract a pure `formatString` from `Format.ts`

Foundational refactor. The new markerless `reviewHasRealFeedback` classifier (in
`Events.ts`, package 02) needs to format REVIEW.md content **in memory** (no disk
write) to compare normalized committed vs working-tree copies. Extract that
capability now as a pure, reusable Effect.

## What to do

- In `src/Format.ts`, add an exported pure function:
  `export const formatString = (content: string): Effect.Effect<string, Error> => …`
  that runs prettier with the existing `PRETTIER_CONFIG` (markdown, printWidth
  80, proseWrap always) and returns the formatted string. NO `FileSystem`
  dependency, NO disk read/write. Use the same `Effect.tryPromise({ try: () =>
  prettier.format(content, PRETTIER_CONFIG), catch: (e) => new Error(...) })`
  shape already present in `formatFile`.
- Refactor `formatFile(path)` to: check existence / read the file as today, then
  delegate the actual formatting to `formatString(content)`, then write back if
  changed. Preserve EXACTLY its current behavior: the "skipped formatting … : not
  found" stderr warning, the skip-on-error `Effect.catchAll` that writes
  "skipped formatting … : <message>" and returns `Effect.void`, and the
  "skip write when already formatted" (only write when `formatted !== content`).
- `PRETTIER_CONFIG` stays the single source of truth — `formatString` and
  `formatFile` must both use it.

## Tests (same task — `src/Format.test.ts`)

- Keep all existing `formatFile` tests passing unchanged (missing-file warning,
  long-line wrap, already-formatted skip, graceful error path).
- Add a `describe("formatString", …)` block covering: a long line is wrapped to
  multiple lines; already-formatted short content round-trips unchanged; the
  returned value is a string (no disk side effects — assert by not providing a
  FileSystem layer, i.e. run it with `Effect.runPromise(formatString(...))`
  directly with NO `NodeContext.layer`).

## Acceptance criteria

- [ ] `formatString(content): Effect.Effect<string, Error>` exported from
      `src/Format.ts`, pure (no FileSystem requirement in its Effect type).
- [ ] `formatFile` refactored to delegate to `formatString`; all prior
      `formatFile` behavior preserved (not-found warning, skip-on-error,
      write-only-when-changed).
- [ ] `PRETTIER_CONFIG` reused by both functions (no duplication).
- [ ] `src/Format.test.ts` adds `formatString` coverage and keeps every existing
      `formatFile` test green.
- [ ] `npm run test` green.

## Files

- `src/Format.ts`
- `src/Format.test.ts`

## Constraints

- Pure: `formatString` must compile with Effect channel `Effect<string, Error>`
  (no `FileSystem.FileSystem` in the requirements channel) — that is the whole
  point, so `Events.ts` can call it inside its existing `Effect.gen`.
- Do not change `PRETTIER_CONFIG` values.
