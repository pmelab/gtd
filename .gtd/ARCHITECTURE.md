## Interfaces

```ts
// src/workflows/feature/packages.ts

// Signature unchanged; parsing changes. An entry is a `- ` list line plus
// every following indented, non-blank continuation line, joined with single
// spaces, then matched against "- unit|e2e: `<path>` [(unchanged)]".
// A continuation stops at a blank line, a new `- ` item (indented or not), a
// `## ` heading, or an unindented line. A heading line is never extended.
// CR/CRLF normalised to LF first. The old marker-only rejoin regex is deleted.
export const declaredTests: (packageText: string) => readonly DeclaredTest[]

// New third parameter: which turn the check runs after.
// "build": also refuses a marked test whose change status is "modified".
// "fix": no modified-marked check; write / restore / missing groups unchanged.
export type DeclaredTestsTurn = "build" | "fix"
export const requireDeclaredTests: (
  pkg: string,
  since: string,
  turn: DeclaredTestsTurn,
) => void

// Refusal groups, in this order, each listed only when non-empty:
//   "not in the package's diff — write them"
//   "marked (unchanged) but modified — revert them"   // new, build turn only
//   "marked (unchanged) but deleted — restore them"
//   "missing from the tree"
// Modified-marked refuses with `.gtd/SATISFIED.md` present too.
```

```ts
// src/workflows/shared/text.ts — signatures unchanged, rendered wording changes

// Tests rule, one rule: list every test the package writes or changes; also
// list an existing test a criterion relies on, marked `(unchanged)`; list no
// other untouched test. Shows both forms:
//   - unit: `<path>` (unchanged)
//   - e2e: `<path>` (unchanged)
// Keeps "only decompose places the marker". Drops "never one it leaves untouched".
export const architectureDecomposePrompt: () => string

// "needs only to exist: leave that file alone" becomes: a line marked
// `(unchanged)` must exist and stay untouched — editing it refuses the turn.
export const packagesItemBuildingPrompt: (pkg: string) => string
```

## Call Stacks

- `gtd land` (packages.item.building) → `packageItem` → `build(pkg)` →
  `requireDeclaredTests(pkg, from, "build")` → `changesSince` + `declaredTests`
  → `refuse` on any group
- `gtd land` (packages.item.fix.suite.fixing) → `healthy` → `fixSuite` →
  `requireDeclaredTests(pkg, from, "fix")` → `changesSince` + `declaredTests` →
  `refuse` on write / restore / missing only
- decompose turn → `architectureDecomposePrompt` → package files carrying
  `## Tests` with `(unchanged)` markers
- build turn → `packagesItemBuildingPrompt(pkg)` → builder told a marked test
  stays untouched

## E2E Scenarios

- e2e: tests/integration/features/declared-tests.feature — a build that edits a
  test marked `(unchanged)` is refused, stderr names the path and "revert"
  (covers 2)
- e2e: tests/integration/features/declared-tests.feature — a build that edits a
  marked test is refused even with `.gtd/SATISFIED.md` written (covers 2)
- e2e: tests/integration/features/declared-tests.feature — a suite fix that
  edits a marked test the build left alone advances to the health check
  (covers 2)
- e2e: tests/integration/features/declared-tests.feature — a package whose
  `## Tests` entry oxfmt wrapped (path on the next line, marker on the next
  line) is guarded like a one-line entry (covers 1)

## Unit Tests

### declaredTests

- unit: src/workflows/feature/packages.test.ts — one-line unit and e2e entries
  parse, with and without the marker (covers 1)
- unit: src/workflows/feature/packages.test.ts — path wrapped onto the line
  after `- unit:` / `- e2e:` parses (covers 1)
- unit: src/workflows/feature/packages.test.ts — `(unchanged)` wrapped onto the
  line after the path sets `unchanged` (covers 1)
- unit: src/workflows/feature/packages.test.ts — CRLF and lone CR parse like LF
  for every wrapped form (covers 1)
- unit: src/workflows/feature/packages.test.ts — an indented `(unchanged)` line
  right after `## Tests` leaves the heading matching and its entries intact
  (covers 1)
- unit: src/workflows/feature/packages.test.ts — a continuation never crosses a
  blank or whitespace-only line, a new `- ` item, or a `## ` heading (covers 1)

### requireDeclaredTests

- unit: src/workflows/feature/packages.test.ts — build turn: a marked test with
  status "modified" refuses under
  `marked (unchanged) but modified — revert them` (covers 2)
- unit: src/workflows/feature/packages.test.ts — build turn: modified-marked
  refuses with `.gtd/SATISFIED.md` present (covers 2)
- unit: src/workflows/feature/packages.test.ts — fix turn: a modified marked
  test passes (covers 2)
- unit: src/workflows/feature/packages.test.ts — fix turn: deleted-marked still
  refuses under `restore them`, absent still under missing (covers 2)
- unit: src/workflows/feature/packages.test.ts — groups order write, revert,
  restore, missing (covers 2)
- unit: src/workflows/feature/packages.test.ts — `packages` passes "build" after
  the build turn and "fix" after each fix turn (covers 2)

### architectureDecomposePrompt

- unit: src/workflows/shared/text.test.ts — states the one tests rule
  (write-or-change, relied-on marked `(unchanged)`, no other untouched test), no
  longer "never one it leaves untouched" (covers 3)
- unit: src/workflows/shared/text.test.ts — shows both
  ``- unit: `<path>` (unchanged)`` and ``- e2e: `<path>` (unchanged)``, keeps
  "only decompose places the marker" (covers 3)

### packagesItemBuildingPrompt

- unit: src/workflows/shared/text.test.ts — says a marked test must exist and
  stay untouched and that editing it refuses the turn; no longer "needs only to
  exist" (covers 2)

### Chores

- chore: README.md — step 3: a marked test "must exist and stay untouched"
  instead of "need only exist" (covers 2)
- chore: tests/integration/features/declared-tests.feature — feature
  description: marked test must exist and stay untouched on the build turn
  (covers 2)

## Merged Concerns

### 1 + 2 → one package: parsing and the modified-marked refusal

Both center on `src/workflows/feature/packages.ts` and its test file; concern
2's guard reads exactly what concern 1's parser returns.

> ### 1. `## Tests` parsing reads whole list items — TECHNICAL
>
> - Today one physical line is one entry. **oxfmt wraps a long entry**, so
>   `- unit:` can end a line with the backticked path on the next, or the path
>   line can push ` (unchanged)` onto the next — **either way the entry or its
>   marker is silently dropped**
> - **Bug: the current rejoin can glue a wrapped `(unchanged)` onto a `## `
>   heading** — `## Tests (unchanged)` no longer matches, and every test under
>   it vanishes from the guard
> - **New rule: an entry is a `- ` list line plus every following indented,
>   non-blank continuation line**, joined with single spaces, then matched
>   against `- unit|e2e: \`<path>\` [(unchanged)]`
> - **A continuation never crosses a blank line, a new `- ` item, or a `## `
>   heading**; a heading line is never extended
> - Forms that must parse, unit and e2e alike: one-line; path wrapped after
>   `- unit:`; marker wrapped after the path; CRLF line ends
> - Unit cases in `src/workflows/feature/packages.test.ts` pin each form,
>   including an indented `(unchanged)` right after `## Tests`, which must leave
>   the heading and its entries intact

> ### 2. Refuse a marked test the turn modified — PRODUCT
>
> - **A test marked `(unchanged)` that appears in the diff as modified refuses
>   the turn**, in its own group:
>   `marked (unchanged) but modified — revert them`
> - Deleted-and-marked keeps its existing `restore them` group;
>   missing-from-tree keeps its group
> - Holds with `.gtd/SATISFIED.md` written too — a satisfied package changes
>   nothing in the tree anyway
> - **Build turn only**: the build turn's check refuses a modified marked test;
>   the recheck after each fix turn does not, so a fix turn may repair a marked
>   test the package's code broke
> - **Risk: after the build turn lands, a fix turn can weaken a marked test
>   unseen by this guard** — review's `Weakened:` check still sees e2e scenarios
> - The existing check takes a small parameter naming the turn it checks; the
>   `restore them` and missing-from-tree groups keep applying to fix turns too
> - `src/workflows/feature/packages.test.ts` and
>   `tests/integration/features/declared-tests.feature` (tagged `@inmem`) cover
>   the refusal and its message
> - **README's step 3 says a marked test "need only exist"** — extend it to
>   "must exist and stay untouched"
> - The build prompt's "leave that file alone" becomes a stated refusal: editing
>   a marked test refuses the turn

Concern 3 stays its own package: it centers on the decompose prompt in
`src/workflows/shared/text.ts`.

**Risk: after the build turn lands, a fix turn can weaken a marked test unseen
by this guard** — review's `Weakened:` check still sees e2e scenarios, not unit
tests.

## Answered Questions

### Are the three deferred review notes (836985b, daed27f, eda53bb) part of this work?

No — the human deleted them from `.gtd/TODO.md` in the sketch; they are dropped,
not folded.

### Does the marker grammar change (new spellings, other positions)?

No — ` (unchanged)` after the backticked path stays the only form; this work
fixes how wrapped lines are read, not what is written.

### Does a fix turn that edits an `(unchanged)` test get refused too?

No — only the build turn is refused for modifying a marked test; fix turns may
edit it, so a wrong marker cannot loop the fix lap (human's pick).

### Does a fix turn that deletes an `(unchanged)` test still get refused?

Yes — the existing `restore them` recheck after every fix stays; it stops a fix
turn greening the suite by deleting a red declared test.

### What shape does the turn parameter take?

A required `"build" | "fix"` string union — reads at the call site, no boolean
trap, and both callers live in `packageItem`.

### Where does the new group sit in the refusal?

Between write and restore — the order runs from "do work" to "undo damage" to
"gone", and the existing order test grows one row.

### Does a marked test the build turn added (absent at `since`) count as modified?

No — only change status `"modified"` refuses; an added file was never the
existing test the marker names, and the existing groups already treat it as
present.

### Does an indented `- ` line continue the entry above it?

No — any `- ` line, indented or not, starts a new item; only non-list indented
lines continue, so a nested bullet never glues onto a test path.

### Does an unindented, non-list, non-blank line continue an entry?

No — oxfmt always indents continuations; an unindented line closes the entry,
keeping prose out of paths.
