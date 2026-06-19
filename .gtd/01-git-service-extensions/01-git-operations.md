# Task: Add Git Service Methods

## Description

Add 5 new methods to `GitOperations` interface and `GitService.Live` in `src/Git.ts` for review feature support.

## File Paths

- `src/Git.ts`

## Implementation

Add to `GitOperations` interface:

```typescript
readonly diffRef: (ref: string) => Effect.Effect<string, Error>
readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
readonly checkoutTracked: () => Effect.Effect<void, Error>
readonly cleanUntracked: () => Effect.Effect<void, Error>
readonly diffStatRef: (ref: string) => Effect.Effect<string, Error>
```

Implement in `GitService.Live`:

| Method | Git Command |
|--------|-------------|
| `diffRef(ref)` | `git diff <ref> HEAD` |
| `resolveRef(ref)` | `git rev-parse <ref>` |
| `checkoutTracked()` | `git checkout -- .` |
| `cleanUntracked()` | `git clean -fd` |
| `diffStatRef(ref)` | `git diff --stat <ref> HEAD` |

Follow existing patterns in `GitService.Live` for command execution and error handling.

## Acceptance Criteria

- [ ] All 5 methods added to `GitOperations` interface
- [ ] All 5 methods implemented in `GitService.Live`
- [ ] Each method maps to exact git command documented above
- [ ] Error type is `Error` (consistent with existing methods)
- [ ] TypeScript compiles without errors
