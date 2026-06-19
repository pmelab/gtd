# Task: Wire Review Prompts into Prompt Builder

## Description

Modify `src/Prompt.ts` to import review prompt files and handle `refDiff` in context building.

## File Paths

- `src/Prompt.ts`

## Dependencies

- Requires prompt files from package 04
- Requires `Branch` type to include review branches (package 02)

## Implementation

### 1. Add Imports

```typescript
import reviewCreate from "./prompts/review-create.md"
import reviewProcess from "./prompts/review-process.md"
```

### 2. Update SECTIONS Record

```typescript
const SECTIONS: Record<Branch, string> = {
  // ... existing entries ...
  "review-create": reviewCreate,
  "review-process": reviewProcess,
}
```

### 3. Modify buildContext()

Handle `refDiff` for review-create branch:

```typescript
// If state.refDiff is present, include it in context
if (state.refDiff) {
  // Add section:
  // ### Diff (`git diff <ref> HEAD`)
  // ```diff
  // <refDiff content>
  // ```
}

// Working tree diff section only shown if state.diff !== ""
if (state.diff !== "") {
  // existing working tree diff section
}
```

### Key Behaviors

- `refDiff` appears as labeled section in context
- Working tree diff suppressed if empty (already may be the case)
- SECTIONS now exhaustively covers all Branch values

## Acceptance Criteria

- [ ] Both prompt files imported
- [ ] Both branches added to `SECTIONS`
- [ ] `buildContext()` renders `refDiff` when present with label `### Diff (\`git diff <ref> HEAD\`)`
- [ ] TypeScript compiles without errors
- [ ] `SECTIONS` type-checks (Branch is now exhaustive)
