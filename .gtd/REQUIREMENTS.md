## Open Questions

### Does a fix turn that edits an `(unchanged)` test get refused too?

The guard reruns after every fix turn, measured from the package's start. Strict
refusal there can trap a fix turn that needs that test edited to turn the suite
green — the #373 loop again, in a new place.

- [ ] Refuse in build and fix turns alike
  - **The marker means "untouched" for the whole package**, no exceptions
  - **Risk: a wrong marker from decompose can loop the fix lap forever**; only a
    human edit to the package breaks it
  - One rule, one check — simplest to build and test
- [x] Refuse in the build turn only; fix turns may edit a marked test
  - **No new loop**: a fix turn can repair a test the package's code broke
  - **The marker stops guarding once the build turn lands** — a fix turn could
    weaken the test unseen by the guard (review's `Weakened:` check still sees
    e2e scenarios)
  - The guard needs to know which turn it checks — a small parameter on the
    existing check
- [ ] _your answer_

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
- Which turns this applies to follows the open question above
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
- **Show both marker forms**: `- unit: \`<path>\` (unchanged)`and`- e2e:
  \`<path>\` (unchanged)`
- Keep "only decompose places the marker"
- `src/workflows/shared/text.test.ts` pins the new wording

## Answered Questions

### Are the three deferred review notes (836985b, daed27f, eda53bb) part of this work?

No — the human deleted them from `.gtd/TODO.md` in the sketch; they are dropped,
not folded.

### Does the marker grammar change (new spellings, other positions)?

No — ` (unchanged)` after the backticked path stays the only form; this work
fixes how wrapped lines are read, not what is written.
