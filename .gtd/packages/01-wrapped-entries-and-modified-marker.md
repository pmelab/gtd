# 01 — Wrapped `## Tests` entries and the modified-marked refusal

## Requirements

### 1. `## Tests` parsing reads whole list items

- **An entry is a `- ` list line plus every following indented, non-blank
  continuation line**, joined with single spaces, then matched against
  ``- unit|e2e: `<path>` [(unchanged)]``
- **A continuation never crosses a blank or whitespace-only line, a new `- `
  item (indented or not), or a `## ` heading**; an unindented line closes the
  entry; a heading line is never extended
- CR and CRLF normalise to LF first; the old marker-only rejoin regex is deleted
- **Fixes the bug where a wrapped `(unchanged)` glued onto `## Tests`** and
  dropped every entry under it
- Forms that parse, unit and e2e alike: one-line; path wrapped after `- unit:`;
  marker wrapped after the path; CRLF/CR line ends

### 2. Refuse a marked test the build turn modified

- **A test marked `(unchanged)` with change status `"modified"` refuses the
  build turn**, in its own group:
  `marked (unchanged) but modified — revert them`
- **Refuses with `.gtd/SATISFIED.md` present too**
- **Build turn only** — the recheck after each fix turn skips it; `restore them`
  (deleted-marked) and missing-from-tree keep applying to both turns
- A marked test the build added (absent at `since`) is not "modified"
- Group order: write, revert, restore, missing — each only when non-empty
- **Risk: after the build turn lands, a fix turn can weaken a marked test unseen
  by this guard** — review's `Weakened:` check sees e2e scenarios, not unit
  tests

## Tasks

### Task 1 — Parse whole list items in `declaredTests`

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] One-line unit and e2e entries parse, with and without the marker
- [ ] Path wrapped onto the line after `- unit:` / `- e2e:` parses
- [ ] `(unchanged)` wrapped onto the line after the path sets `unchanged`
- [ ] CRLF and lone CR parse like LF for every wrapped form
- [ ] An indented `(unchanged)` line right after `## Tests` leaves the heading
      matching and its entries intact
- [ ] A continuation never crosses a blank or whitespace-only line, a new `- `
      item, or a `## ` heading
- [ ] Old marker-only rejoin regex deleted; `declaredTests` signature unchanged

### Task 2 — Turn parameter and modified-marked group in `requireDeclaredTests`

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] `DeclaredTestsTurn = "build" | "fix"` exported; `requireDeclaredTests`
      takes it as a required third parameter
- [ ] Build turn: a marked test with status "modified" refuses under
      `marked (unchanged) but modified — revert them`
- [ ] Build turn: modified-marked refuses with `.gtd/SATISFIED.md` present
- [ ] Fix turn: a modified marked test passes
- [ ] Fix turn: deleted-marked still refuses under `restore them`, absent still
      under missing
- [ ] Groups order write, revert, restore, missing
- [ ] `packages` passes "build" after the build turn and "fix" after each fix
      turn

### Task 3 — Build prompt states the refusal

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`

- [ ] `packagesItemBuildingPrompt` says a line marked `(unchanged)` must exist
      and stay untouched and that editing it refuses the turn
- [ ] No longer says "needs only to exist" / "leave that file alone"

### Task 4 — E2E scenarios

Paths: `tests/integration/features/declared-tests.feature` (tagged `@inmem`)

- [ ] A build that edits a test marked `(unchanged)` is refused; stderr names
      the path and "revert"
- [ ] A build that edits a marked test is refused even with `.gtd/SATISFIED.md`
      written
- [ ] A suite fix that edits a marked test the build left alone advances to the
      health check
- [ ] A package whose `## Tests` entry oxfmt wrapped (path on the next line,
      marker on the next line) is guarded like a one-line entry
- [ ] Feature description: a marked test must exist and stay untouched on the
      build turn

### Task 5 — README

Paths: `README.md`

- [ ] Step 3 says a marked test "must exist and stay untouched" instead of "need
      only exist"

## Tests

- unit: `src/workflows/feature/packages.test.ts`
- unit: `src/workflows/shared/text.test.ts`
- e2e: `tests/integration/features/declared-tests.feature`
