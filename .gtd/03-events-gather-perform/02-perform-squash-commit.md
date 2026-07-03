# Implement `squashCommit` case in `perform()` in Events.ts

File: `src/Events.ts`

## Prerequisite

This task depends on:

- `SQUASH_MSG_FILE` constant defined (task 01 in this package)
- `softResetTo` added to `GitService` / `Git.ts` (package 01, task 03)

## Change: Add `squashCommit` case to the `perform` switch

In the `perform` function's switch statement, after the `done` case (~line
808–813):

```typescript
      case "done": {
        yield* fs.remove(REVIEW_FILE).pipe(Effect.catchAll(() => Effect.void))
        yield* git.commitAllWithPrefix(DONE_SUBJECT)
        return
      }
    }
```

Insert a new case before the closing `}` of the switch:

```typescript
      // Squash commit: remove SQUASH_MSG.md BEFORE git add -A so its deletion
      // is not staged into the squash commit, soft-reset to squashBase (index
      // reset, working tree untouched), re-stage everything, commit with the
      // authored message.
      case "squashCommit": {
        yield* fs.remove(SQUASH_MSG_FILE).pipe(Effect.catchAll(() => Effect.void))
        yield* git.softResetTo(action.squashBase)
        yield* git.commitAllWithPrefix(action.commitMessage)
        return
      }
```

The full switch bottom becomes:

```typescript
      case "done": {
        yield* fs.remove(REVIEW_FILE).pipe(Effect.catchAll(() => Effect.void))
        yield* git.commitAllWithPrefix(DONE_SUBJECT)
        return
      }

      case "squashCommit": {
        yield* fs.remove(SQUASH_MSG_FILE).pipe(Effect.catchAll(() => Effect.void))
        yield* git.softResetTo(action.squashBase)
        yield* git.commitAllWithPrefix(action.commitMessage)
        return
      }
    }
```

## Why SQUASH_MSG.md is removed first

`commitAllWithPrefix` runs `git add -A` then `git commit`. If SQUASH_MSG.md were
still present when `git add -A` runs, its deletion would be staged and the
squash commit would include a deletion of SQUASH_MSG.md. Removing it before the
soft reset means `git add -A` never sees it.
