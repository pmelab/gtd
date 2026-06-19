# Task: Detect review-create Branch

## Description

Modify `detect()` in `src/State.ts` to accept optional `refArg` parameter and detect review-create branch.

## File Paths

- `src/State.ts`

## Dependencies

- Requires `resolveRef()` and `diffRef()` and `diffStatRef()` from `src/Git.ts` (package 01)

## Implementation

### Function Signature

```typescript
export const detect = (refArg?: string) => Effect.gen(function* () {
```

### Detection Logic (early-return, exclusive branch)

Add at start of `detect()` before other branch logic:

1. If `refArg` provided AND dirty tree → throw `Error("Commit or stash changes before starting review")`
2. If `refArg` provided AND `REVIEW.md` exists → throw `Error("REVIEW.md already exists. Complete or delete existing review before starting new one.")`
3. If `refArg` provided → validate via `git.resolveRef(refArg)`:
   - If fails → propagate error from `resolveRef`
4. If `refArg` provided → check `git.diffStatRef(ref)`:
   - If output empty → throw `Error("No changes between \`<ref>\` and HEAD to review")`
5. If all checks pass:
   - Get `refDiff` via `git.diffRef(ref)`
   - Return state with `branches: ["review-create"]`, `baseRef: resolvedRef`, `refDiff`
   - Skip all other branch detection logic (exclusive branch)

### Key Behaviors

- `review-create` is **exclusive**: returns immediately, skips other branch logic
- Error messages must match exactly as specified above
- Use existing git service from Effect context

## Acceptance Criteria

- [ ] `detect()` accepts optional `refArg?: string`
- [ ] Dirty tree + refArg → error message: `"Commit or stash changes before starting review"`
- [ ] REVIEW.md exists + refArg → error message: `"REVIEW.md already exists. Complete or delete existing review before starting new one."`
- [ ] Invalid ref → error propagated from `resolveRef`
- [ ] Empty diff → error message: `"No changes between \`<ref>\` and HEAD to review"`
- [ ] Valid ref → state has `branches: ["review-create"]`, populated `baseRef` and `refDiff`
- [ ] `review-create` branch is exclusive (returns immediately, skips other branch logic)
