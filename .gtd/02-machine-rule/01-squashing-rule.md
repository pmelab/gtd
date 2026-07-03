# Update squashing rule in Machine.ts to emit `squashCommit` edge action

File: `src/Machine.ts`

## Current code (~lines 611–617)

```typescript
if (head === "gtd: done" && p.squashEnabled && p.squashBase !== undefined) {
  return {
    state: "squashing",
    autoAdvance: true,
    context: buildContext(p, counters),
  }
}
```

## New code

Replace the block above with:

```typescript
if (head === "gtd: done" && p.squashEnabled && p.squashBase !== undefined) {
  if (p.squashMsgPresent) {
    // Agent wrote SQUASH_MSG.md — edge performs the squash commit.
    return {
      state: "squashing",
      autoAdvance: true,
      edgeAction: {
        kind: "squashCommit",
        squashBase: p.squashBase,
        commitMessage: p.squashMsgContent,
      },
      context: buildContext(p, counters),
    }
  }
  // No SQUASH_MSG.md yet — prompt the agent to write the commit message.
  return {
    state: "squashing",
    autoAdvance: false,
    context: buildContext(p, counters),
  }
}
```

Key changes:

- When `squashMsgPresent` is true: emit `squashCommit` edge action with
  `autoAdvance: true`
- When `squashMsgPresent` is false: `autoAdvance: false` (was `true`), no
  `edgeAction` — the agent runs and writes SQUASH_MSG.md

No other changes to this file.
