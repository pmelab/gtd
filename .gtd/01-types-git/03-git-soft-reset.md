# Add `softResetTo` to Git.ts

File: `src/Git.ts`

## Changes

### 1. Add method to `GitOperations` interface (after `commitAllWithPrefix`, ~line 68)

After the `commitAllWithPrefix` method signature:

```typescript
  readonly commitAllWithPrefix: (prefix: string) => Effect.Effect<void, Error>
```

Add:

```typescript
  /** `git reset --soft <ref>` — moves HEAD to ref, leaving index and working tree unchanged. */
  readonly softResetTo: (ref: string) => Effect.Effect<void, Error>
```

### 2. Add implementation to `GitService.Live` (after the `commitAllWithPrefix` implementation, ~line 319–323)

After:

```typescript
        commitAllWithPrefix: (prefix: string) =>
          Effect.gen(function* () {
            yield* exec("git", "add", "-A")
            yield* exec("git", "commit", "--allow-empty", "-m", prefix)
          }).pipe(Effect.asVoid),
```

Add:

```typescript
        softResetTo: (ref: string) =>
          exec("git", "reset", "--soft", ref).pipe(Effect.asVoid),
```

No other changes to this file.
