# Task: Add Review Branch Types

## Description

Extend `Branch` type union and `State` interface in `src/State.ts` to support review mode.

## File Paths

- `src/State.ts`

## Implementation

### Branch Type

Add to `Branch` union:

```typescript
export type Branch =
  | ... existing ...
  | "review-create"     // git ref provided, generate REVIEW.md
  | "review-process"    // REVIEW.md exists with changes, convert to TODO
```

### State Interface

Add optional fields:

```typescript
export interface State {
  // ... existing fields ...
  readonly baseRef?: string    // resolved git ref for review
  readonly refDiff?: string    // git diff <ref> HEAD output
}
```

## Acceptance Criteria

- [ ] `Branch` union includes `"review-create"` and `"review-process"`
- [ ] `State` interface has optional `baseRef?: string` field
- [ ] `State` interface has optional `refDiff?: string` field
- [ ] TypeScript compiles without errors
