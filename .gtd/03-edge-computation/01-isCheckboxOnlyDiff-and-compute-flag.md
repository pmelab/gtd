# Edge: `isCheckboxOnlyDiff` helper + compute `reviewCheckboxOnly`

Add the pure diff helper and wire the flag computation at the Effect edge in
`src/Events.ts`.

## Depends on

- Package 01: `git.diffPath(path)` must exist on `GitService`.
- Package 02: `reviewCheckboxOnly` must exist on `ResolvePayload` (defaults
  `false`).

## Context

- `src/Events.ts:208-210` —
  `reviewDirty = reviewTrackedAtHead && !workingTreeClean`
- `entries` parse already lists dirty paths; `REVIEW_FILE` constant is the
  REVIEW.md path.
- `seedTodo` is an existing pure, isolated-testable helper — mirror that style.

## Implementation

1. Add a pure exported helper `isCheckboxOnlyDiff(diff: string): boolean` in
   `src/Events.ts`:
   - Returns `false` for an empty diff (no actual change).
   - Inspects every changed line. For each removed (`-`) line there must be a
     paired added (`+`) line that is IDENTICAL except the box marker `[ ]` ↔
     `[x]` (case-insensitive `x`).
   - Both `- [ ]` → `- [x]` (tick) and `- [x]` → `- [ ]` (un-tick) count as
     flips.
   - Any added/removed changed line that is NOT such a flip → `false`.
   - Ignore diff header lines (`+++`, `---`, `@@`, file metadata) — only the
     actual `+`/`-` content lines are evaluated.

2. Compute `reviewCheckboxOnly` at the edge and pass it into the
   `ResolvePayload`:
   - `onlyReviewDirty` = the dirty `entries` contain ONLY `REVIEW_FILE` (no code
     changes, no `.gtd`, no other steering files).
   - `reviewCheckboxOnly = onlyReviewDirty && isCheckboxOnlyDiff(diff)` where
     `diff` is `git.diffPath(REVIEW_FILE)`.
   - Set it on the resolve payload alongside `reviewDirty`.

## Acceptance criteria

- [ ] Exported pure helper `isCheckboxOnlyDiff(diff: string): boolean` in
      `src/Events.ts`
- [ ] Empty diff → `false`
- [ ] Diff containing any non-checkbox-flip changed line → `false`
- [ ] Both tick and un-tick flips → `true`
- [ ] Edge sets
      `reviewCheckboxOnly = (only REVIEW.md dirty) &&     isCheckboxOnlyDiff(git.diffPath(REVIEW_FILE))`
      on the ResolvePayload
- [ ] Uses `git.diffPath` (from package 01); does not re-shell git inline
- [ ] Typecheck passes; full test suite is green
