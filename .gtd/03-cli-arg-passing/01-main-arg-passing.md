# Task: Pass CLI Argument to detect()

## Description

Modify `src/main.ts` to read optional git ref argument from command line and pass to `detect()`.

## File Paths

- `src/main.ts`

## Dependencies

- Requires `detect()` to accept optional `refArg` parameter (package 02)

## Implementation

Change:

```typescript
const state = yield* detect()
```

To:

```typescript
const refArg = process.argv[2]
const state = yield* detect(refArg)
```

### Notes

- `process.argv[2]` is `undefined` if no argument provided
- No validation needed here — `detect()` handles all validation
- Keep change minimal — only add argument reading and passing

## Acceptance Criteria

- [ ] `process.argv[2]` read and passed to `detect()`
- [ ] No other changes to main.ts
- [ ] TypeScript compiles without errors
