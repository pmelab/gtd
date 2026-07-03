# Add SQUASH_MSG_FILE constant and gather squashMsgPresent/squashMsgContent in Events.ts

File: `src/Events.ts`

## Change 1: Add constant (after `REVIEW_FEEDBACK_SUBJECT` constant, ~line 51)

After:

```typescript
const REVIEW_FEEDBACK_SUBJECT = "gtd: review feedback"
```

Add:

```typescript
const SQUASH_MSG_FILE = "SQUASH_MSG.md"
```

## Change 2: Add SQUASH_MSG_FILE to STEERING_FILES (~line 59)

Current:

```typescript
const STEERING_FILES: ReadonlyArray<string> = [
  TODO_FILE,
  REVIEW_FILE,
  FEEDBACK_FILE,
  ERRORS_FILE,
]
```

New:

```typescript
const STEERING_FILES: ReadonlyArray<string> = [
  TODO_FILE,
  REVIEW_FILE,
  FEEDBACK_FILE,
  ERRORS_FILE,
  SQUASH_MSG_FILE,
]
```

This excludes SQUASH_MSG.md from code diffs and review diffs.

## Change 3: Probe SQUASH_MSG_FILE in gatherEvents (after the `squashDiff` block, just before the payload object, ~line 604)

Find the block that ends the squash gathering:

```typescript
    }

    const payload: ResolvePayload = {
```

Insert before `const payload: ResolvePayload = {`:

```typescript
// --- SQUASH_MSG.md presence (squash commit message written by agent) --------
const squashMsgPresent = yield * fs.exists(SQUASH_MSG_FILE)
const squashMsgContent = squashMsgPresent
  ? yield * fs.readFileString(SQUASH_MSG_FILE)
  : ""
```

## Change 4: Add fields to the payload object

In the `payload: ResolvePayload = { ... }` object (at the end, after the
`squashDiff` spread):

After:

```typescript
      ...(squashDiff !== undefined ? { squashDiff } : {}),
```

Add:

```typescript
      squashMsgPresent,
      squashMsgContent,
```

No other changes to this file in this task.
