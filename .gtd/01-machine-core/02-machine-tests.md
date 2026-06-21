# Task: Unit-test the machine fold

Create `src/Machine.test.ts` (vitest) covering the pure fold from
`src/Machine.ts`. Use the `tdd` skill discipline. This must pass with `npm test`.

## What to cover

1. **COMMIT counter folding** (`verifyIterations`):
   - Empty event stream → `verifyIterations === 0`
   - Sequence ending in N consecutive `isFixGtd: true` COMMITs → counter === N
   - A non-fix COMMIT anywhere resets: `[fix, fix, non-fix, fix]` → counter === 1
   - Trailing run only: `[fix, fix, fix]` → 3

2. **RESOLVE → leaf + tag** (one assertion per priority rung, each proving the
   guard order by setting higher-priority flags false):
   - `reviewModified` → `review-process`, `hasTag("auto-advance")` true
   - `codeDirty` → `code-changes`, auto-advance true
   - `hasPackages` → `execute`, auto-advance true
   - `gtdDirExists` only → `cleanup`, auto-advance true
   - `todoFinalized` + `todoSimple` → `execute-simple`; without simple →
     `decompose` (both auto-advance true)
   - counter ≥ cap (via preceding COMMITs) → `escalate`, auto-advance **false**
   - `todoDirty: "new"` → `new-todo`; `"modified"` → `modified-todo` (auto-advance
     true)
   - clean + `reviewBasePresent` + non-empty `refDiff` → `human-review`,
     auto-advance **false**
   - clean + no review base → `verified`, auto-advance **false**

3. **Counter vs escalate interaction**: feed cap-many `fix(gtd)` COMMITs then a
   `RESOLVE` whose only-otherwise-match would be `verified`/`new-todo`; assert
   `escalate` wins (proves rung 6 priority).

## Acceptance criteria

- [ ] `src/Machine.test.ts` exercises every leaf and the counter logic
- [ ] Tests assert both `value` and `autoAdvance`/`hasTag`
- [ ] `npm test` passes (Machine suite green)

## Files

- `src/Machine.test.ts` (new)
- Reference: `src/Machine.ts` (from sibling task), existing `src/Prompt.test.ts`
  and `src/Git.test.ts` for vitest style

## Constraints

- No git/filesystem — drive the machine purely with hand-built event arrays.
