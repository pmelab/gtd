# 01 — Guard: added marked test, required turn, dedupe

See `.gtd/ARCHITECTURE.md` (Interfaces, Merged Concerns) for the pinned
signature and group wording. One package: concerns 1–3 all change
`requireDeclaredTests` and its test file; concern 4 is a no-code chore.

## Requirements

**Concern 1 — Refuse a build turn that adds a test marked (unchanged).**

- **Build turn, marked test, diff status `added` → refused** in a new group
  `marked (unchanged) but added by this turn — the marker promises an existing test; stop and leave it to a person`
- **The new group never says delete, revert or restore** — deleting trips
  "missing from the tree" next turn (the #373 loop)
- **Group order: write, revert, added, restore, missing**; existing four
  wordings unchanged
- **Fix turn: an added marked test is not refused** (as decided in 08eaee9)
- **A path listed both unmarked and marked: the unmarked entry wins** — the
  existing early `continue` runs before bucketing, so adding it passes
- **Build prompt and README step 3 state the rule**: a marked test must exist
  before the turn; the build turn must not create, edit or delete it

**Concern 2 — `turn` is required.** `requireDeclaredTests(pkg, since, turn)`
loses `= "fix"`; every caller and test names the turn. `packageItem` already
passes it.

**Concern 3 — Each refused path appears once.** A `seen` set skips a path
already pushed; the first bucket keeps it. Covers duplicated `## Tests` lines,
within and across groups.

**Concern 4 — Deferred review notes dismissed.** The three
`## Deferred review notes` blocks in `.gtd/TODO.md` (836985b, daed27f, eda53bb)
are not built; no code changes for them.

## Tasks

### 1. `addedMarked` bucket and group

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] `diffBucket`: marked, `turn === "build"`, status `"added"` →
      `"addedMarked"`; `"modified"` → `"modifiedMarked"` unchanged; fix turn
      returns `undefined` for both
- [ ] New group emitted right after the modified group, before the deleted
      group, with the exact wording above
- [ ] Unit: build turn, marked `added` → refused under "added by this turn …
      stop and leave it to a person"; message holds no "delete", "revert" or
      "restore"
- [ ] Unit: replace "does not call a marked test the build added modified" — an
      added marked test is refused as added, never as modified
- [ ] Unit: fix turn, marked `added` → no refusal
- [ ] Unit: build turn, path listed unmarked and marked, `added` → no refusal
- [ ] Unit: group-order test extended to write, revert, added, restore, missing

### 2. Required `turn`

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] Drop `= "fix"` from `requireDeclaredTests`'s `turn`
- [ ] JSDoc says the build turn must neither modify nor add a marked test
- [ ] Unit helper calls `requireDeclaredTests(pkg, "c", turn)` explicitly; no
      call in the suite reaches the guard with a defaulted turn
- [ ] `npm run typecheck` passes — the compiler rejects any call omitting `turn`

### 3. Dedupe refused paths

Paths: `src/workflows/feature/packages.ts`,
`src/workflows/feature/packages.test.ts`

- [ ] `seen` set checked before every push; first bucket keeps the path
- [ ] Unit: a `## Tests` line duplicated verbatim, unwritten → path appears
      exactly once in the message
- [ ] Unit: a duplicated marked line missing from the tree → path appears
      exactly once

### 4. Build prompt and README

Paths: `src/workflows/shared/text.ts`, `src/workflows/shared/text.test.ts`,
`README.md`

- [ ] Build turn's `(unchanged)` bullet says a marked test must exist before the
      turn and the turn must not create, edit or delete it; keeps "stop and
      leave it to a person"
- [ ] Unit in `text.test.ts` asserts both phrases
- [ ] README step 3 states the same rule

### 5. E2E scenarios

Paths: `tests/integration/features/declared-tests.feature`

- [ ] `@inmem` scenario: build turn creates a file its package lists as
      ``- unit: `lib/new.test.ts` (unchanged)`` → `gtd land` fails; stderr names
      the path and says "stop and leave it to a person"
- [ ] `@inmem` scenario: build turn creates a file listed both unmarked and
      marked `(unchanged)` → `gtd land` succeeds and advances to the health
      check
- [ ] Composable, generic Given steps; file content visible in scenario text

### 6. Dismiss deferred review notes (chore)

Paths: `.gtd/TODO.md`

- [ ] No code change for the three deferred notes (836985b, daed27f, eda53bb);
      they leave with this process's `.gtd/TODO.md`

### Done when

- [ ] `npm test` green, `format:check` and `lint:boundaries` clean

## Tests

- unit: `src/workflows/feature/packages.test.ts`
- unit: `src/workflows/shared/text.test.ts`
- e2e: `tests/integration/features/declared-tests.feature`
