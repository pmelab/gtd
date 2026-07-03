# Add `squashMsgPresent` / `squashMsgContent` to ResolvePayload and DEFAULT_PAYLOAD

File: `src/Machine.ts`

## Changes

### 1. Add fields to `ResolvePayload` interface (after `squashEnabled`, ~line 159)

After this line:

```
  readonly squashEnabled: boolean
```

Add:

```typescript
  /** `SQUASH_MSG.md` is present in the repo root — agent wrote the squash commit message. */
  readonly squashMsgPresent: boolean
  /** Full text of `SQUASH_MSG.md` ("" when absent). */
  readonly squashMsgContent: string
```

### 2. Add fields to `DEFAULT_PAYLOAD` (after `squashEnabled: false`, ~line 322)

After this line:

```
  squashEnabled: false,
```

Add:

```typescript
  squashMsgPresent: false,
  squashMsgContent: "",
```

No other changes to this file in this task.
