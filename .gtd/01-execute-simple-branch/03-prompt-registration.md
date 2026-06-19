# Register execute-simple prompt in Prompt.ts

## Description

Import the new `execute-simple.md` prompt and register it in the SECTIONS map and AUTO_ADVANCE_BRANCHES set.

## Files to modify

- `src/Prompt.ts`

## Implementation

### 1. Add import

Add import for execute-simple after the existing execute import:

```typescript
import execute from "./prompts/execute.md"
import executeSimple from "./prompts/execute-simple.md"  // ADD THIS
```

### 2. Add to SECTIONS map

Add entry in SECTIONS record (maintain alphabetical-ish order, put near execute):

```typescript
const SECTIONS: Record<Branch, string> = {
  "new-todo": newTodo,
  "modified-todo": modifiedTodo,
  decompose,
  execute,
  "execute-simple": executeSimple,  // ADD THIS
  cleanup,
  // ... rest
}
```

### 3. Add to AUTO_ADVANCE_BRANCHES

Add to the auto-advance set:

```typescript
const AUTO_ADVANCE_BRANCHES: ReadonlySet<Branch> = new Set([
  "new-todo",
  "modified-todo",
  "decompose",
  "execute",
  "execute-simple",  // ADD THIS
  "cleanup",
  // ... rest
])
```

## Acceptance criteria

- [ ] `execute-simple.md` is imported with correct path
- [ ] `"execute-simple"` key exists in SECTIONS map
- [ ] `"execute-simple"` is in AUTO_ADVANCE_BRANCHES set
- [ ] TypeScript compiles without errors
- [ ] All existing Branch types still mapped (no regressions)
