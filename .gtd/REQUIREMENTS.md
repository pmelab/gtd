# Requirements: PR 401 review fixes for the declared-tests guard

Source: the `.gtd/TODO.md` sketch in `d4b16663`, a review of PR #401 (branch
`fix/373-guard-empty-packages`, fix already landed in `9ccfb6ea`). Every concern
below refines that fix; none changes what the guard accepts or refuses beyond
what is stated.

The same sketch deleted the three `## Deferred review notes` sections (note-1
`runSummaryCommand` doc comment, note-2 `gtd history list` scenario, note-3
garbled-flag stdout assertion). **Those notes are dropped, not built.**

## Concerns

### 1. Marker parse tolerates whitespace, case and CRLF, never joins across blank lines — TECHNICAL

`declaredTests` in `src/workflows/feature/packages.ts` reads the ` (unchanged)`
marker too strictly and rejoins wrapped lines too loosely.

- **Any run of spaces or tabs between the closing backtick and `(unchanged)`
  counts**, not exactly one space
- **The marker matches case-insensitively**: `(Unchanged)`, `(UNCHANGED)` mark
  the test. The existing unit case asserting `(Unchanged)` → `false` flips to
  `true`
- **The trailing boundary stays**: `(unchanged)x` still does not mark
- **CRLF package text parses the same as LF**, including a CRLF-wrapped marker
  on its own continuation line (today the leftover `\r` breaks the rejoin)
- **The continuation rejoin never crosses a blank line**: a `(unchanged)` line
  separated from its test line by an empty (or whitespace-only) line is not
  joined, so that test stays unmarked
- Unit cases in `src/workflows/feature/packages.test.ts` cover each bullet

### 2. Build prompt states the SATISFIED rule without a nested "otherwise" — TECHNICAL

`packagesItemBuildingPrompt` in `src/workflows/shared/text.ts` packs the
already-met case, the out-of-tree case, the duplicate check and the normal path
into one bullet with two "otherwise" branches. **Rewrite it as flat,
separately-stated rules, no nested otherwise:**

- every criterion already met in the tree → write `.gtd/SATISFIED.md` with
  evidence per criterion, change nothing else
- package with no `## Tests` whose work lies outside the tree → first check an
  earlier attempt did not already do it (e.g. existing issue via `gh`), reuse
  that as evidence or do the work, then write `.gtd/SATISFIED.md`; change
  nothing else in the tree
- anything else → implement normally, no `.gtd/SATISFIED.md`
- **Keep every substance the current prompt carries** (evidence kinds: commit,
  file, symbol, issue URL, command output; the duplicate check); update the
  `packagesItemBuildingPrompt` assertions in `src/workflows/shared/text.test.ts`
  to the new wording

### 3. Refusal header drops the word "satisfied" and says "restore" for a deleted unchanged test — TECHNICAL

`requireDeclaredTests` refuses with
`declares tests that are not satisfied — write them first`. "Satisfied" collides
with the **satisfied package** term (`.gtd/SATISFIED.md`), and "write them
first" is the wrong remedy for a marked test the build deleted.

- **The header avoids the word "satisfied"** in any form
- **A test marked `(unchanged)` that the build deleted is told to be restored**,
  under its own group, not told to be written
- Not-in-diff and missing-from-tree paths stay listed as separate groups, as
  today
- Unit test in `packages.test.ts` and the `@inmem` deleted-marked-test scenario
  in `tests/integration/features/declared-tests.feature` assert the new wording

### 4. `@inmem` scenario: a test-less package writes only SATISFIED.md and closes — TECHNICAL

`tests/integration/features/declared-tests.feature` has no scenario for the
out-of-tree case PR #401 added.

- **New `@inmem` scenario**: a package file with no `## Tests` section; the
  build turn writes only `.gtd/SATISFIED.md` (evidence such as an issue URL) and
  nothing else in the tree; `gtd land` succeeds, and the package runs on through
  closing, which removes the package file and `.gtd/SATISFIED.md`
- Reuse the existing composable Given steps; show file contents in the scenario
  text

### 5. One `range.get` per declared test — TECHNICAL

`requireDeclaredTests` calls `range.get(test.path)` twice per test. **Look each
path up once** and reuse the result. Pure refactor: no behaviour or message
change beyond concern 3.

## Answered Questions

### Should the deleted deferred review notes be folded in anyway?

No. The human removed all three sections in the sketch commit, alongside the PR
401 directive; removal is the answer.

### Does a marked test that never existed in the tree (decompose's mistake) get "restore"?

No. "Restore" applies only when the diff shows the path deleted; a marked path
absent with no deletion stays under "missing from the tree", since there is
nothing to restore.

### Does "any whitespace" before the marker include none at all?

No: at least one space or tab is required, so `` `a.test.ts`(unchanged) `` does
not mark. The sketch's complaint is about the exact-single-space rule, and a
backtick glued to the paren is not how decompose or oxfmt writes the line.

### Do README.md or CONTEXT.md need changes?

No. Neither states the marker's exact spacing, its case, or the refusal text;
the `(unchanged)` and out-of-tree descriptions PR #401 added stay accurate.
