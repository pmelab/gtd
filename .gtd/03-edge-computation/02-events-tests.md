# Unit tests for `isCheckboxOnlyDiff` + edge flag computation

Add tests in `src/Events.test.ts`. Separate file from `src/Events.ts`, so runs
in parallel with the implementation task.

## Depends on

- Same package's implementation task defines `isCheckboxOnlyDiff` and the edge
  wiring; tests target those names/behavior.

## Implementation

1. `isCheckboxOnlyDiff` helper cases (pure, no git):
   - pure `- [ ]` → `- [x]` diff → `true`
   - un-tick `- [x]` → `- [ ]` diff → `true`
   - diff that also changes text / adds a comment → `false`
   - diff adding a new non-checkbox line → `false`
   - empty diff → `false`

2. `runGather`-style edge cases (mirror existing Events.test.ts gather tests):
   - committed REVIEW.md + ONLY checkbox edits in working tree →
     `reviewCheckboxOnly: true`, `reviewDirty: true`
   - committed REVIEW.md + a textual annotation (non-checkbox) →
     `reviewCheckboxOnly: false`, `reviewDirty: true`

## Acceptance criteria

- [ ] All five `isCheckboxOnlyDiff` cases asserted (tick, un-tick, text-change,
      new-line, empty)
- [ ] Gather case: checkbox-only edit → `reviewCheckboxOnly: true` &
      `reviewDirty: true`
- [ ] Gather case: text annotation → `reviewCheckboxOnly: false` &
      `reviewDirty: true`
- [ ] Tests reuse the existing Events.test.ts gather/helper style
- [ ] Full test suite is green
