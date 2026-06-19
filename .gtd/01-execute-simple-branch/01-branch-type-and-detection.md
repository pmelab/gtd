# Add execute-simple branch type and detection logic

## Description

Add the `execute-simple` branch type to State.ts and implement detection logic that routes to it when TODO.md contains `<!-- simple -->` marker.

## Files to modify

- `src/State.ts`

## Implementation

### 1. Add branch type

Add `"execute-simple"` to the `Branch` type union:

```typescript
export type Branch =
  | "new-todo"
  | "modified-todo"
  | "decompose"
  | "execute"
  | "execute-simple"  // ADD THIS
  | "cleanup"
  // ... rest
```

### 2. Modify detection logic

In the `detect()` function, find where `todoFinalized` leads to `decompose`:

```typescript
} else if (todoFinalized) {
  // TODO.md has no unanswered questions — decompose into packages
  branches.push("decompose")
}
```

Change it to check for `<!-- simple -->` marker:

```typescript
} else if (todoFinalized) {
  const todoContent = yield* fs.readFileString(TODO_FILE)
  const isSimple = todoContent.includes("<!-- simple -->")
  if (isSimple) {
    branches.push("execute-simple")
  } else {
    branches.push("decompose")
  }
}
```

## Acceptance criteria

- [ ] `"execute-simple"` is a valid `Branch` type
- [ ] When TODO.md exists, is finalized (no `<!-- user answers here -->`), and contains `<!-- simple -->` → branch is `execute-simple`
- [ ] When TODO.md exists, is finalized, but lacks `<!-- simple -->` → branch is `decompose` (existing behavior preserved)
- [ ] TypeScript compiles without errors
