## Concerns

### 1. `## Tests` parsing reads whole list items — TECHNICAL

- Today one physical line is one entry. **oxfmt wraps a long entry**, so
  `- unit:` can end a line with the backticked path on the next, or the path
  line can push ` (unchanged)` onto the next — **either way the entry or its
  marker is silently dropped**
- **Bug: the current rejoin can glue a wrapped `(unchanged)` onto a `## `
  heading** — `## Tests (unchanged)` no longer matches, and every test under it
  vanishes from the guard
- **New rule: an entry is a `- ` list line plus every following indented,
  non-blank continuation line**, joined with single spaces, then matched against
  `- unit|e2e: \`<path>\` [(unchanged)]`
- **A continuation never crosses a blank line, a new `- ` item, or a `## `
  heading**; a heading line is never extended
- Forms that must parse, unit and e2e alike: one-line; path wrapped after
  `- unit:`; marker wrapped after the path; CRLF line ends
- Unit cases in `src/workflows/feature/packages.test.ts` pin each form,
  including an indented `(unchanged)` right after `## Tests`, which must leave
  the heading and its entries intact

### 2. Refuse a marked test the turn modified — PRODUCT

- **A test marked `(unchanged)` that appears in the diff as modified refuses the
  turn**, in its own group: `marked (unchanged) but modified — revert them`
- Deleted-and-marked keeps its existing `restore them` group; missing-from-tree
  keeps its group
- Holds with `.gtd/SATISFIED.md` written too — a satisfied package changes
  nothing in the tree anyway
- **Build turn only**: the build turn's check refuses a modified marked test;
  the recheck after each fix turn does not, so a fix turn may repair a marked
  test the package's code broke
- **Risk: after the build turn lands, a fix turn can weaken a marked test unseen
  by this guard** — review's `Weakened:` check still sees e2e scenarios
- The existing check takes a small parameter naming the turn it checks; the
  `restore them` and missing-from-tree groups keep applying to fix turns too
- `src/workflows/feature/packages.test.ts` and
  `tests/integration/features/declared-tests.feature` (tagged `@inmem`) cover
  the refusal and its message
- **README's step 3 says a marked test "need only exist"** — extend it to "must
  exist and stay untouched"
- The build prompt's "leave that file alone" becomes a stated refusal: editing a
  marked test refuses the turn

### 3. Decompose prompt rule stops contradicting itself — TECHNICAL

- Today: "List only tests the package writes or changes, **never one it leaves
  untouched**; an existing unchanged test … is written `(unchanged)`" — the
  second clause breaks the first
- **Reword as one rule**: list every test the package writes or changes; also
  list an existing test a criterion relies on, marked `(unchanged)`; list no
  other untouched test
- **Show both marker forms**: ``- unit: `<path>` (unchanged)`` and
  ``- e2e: `<path>` (unchanged)``
- Keep "only decompose places the marker"
- `src/workflows/shared/text.test.ts` pins the new wording

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
