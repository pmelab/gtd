# Remove the `clean` exception in Prompt.ts stop-partial append

## File

`src/Prompt.ts` (around line 211)

## Change

Remove the `promptState !== "clean"` exception so the stop partial is appended
for the `clean` state like every other non-autoAdvance state.

Before:

```js
if (!result.autoAdvance && promptState !== "clean") parts.push(stopPartial, "")
if (result.autoAdvance) parts.push(autoAdvance, "")
```

After:

```js
if (!result.autoAdvance) parts.push(stopPartial, "")
if (result.autoAdvance) parts.push(autoAdvance, "")
```

Only the first line changes; leave the `autoAdvance` line untouched.

## Context / rationale

Previously `clean.md` embedded its own inline ⛔ STOP block (removed in task
02). With that gone, `clean` must receive the shared `stopPartial` (which
contains ⛔) like the other non-auto-advance states. This keeps the STOP banner
on the clean state's prompt.

## Tests

No test changes needed. `src/Prompt.test.ts` "clean gets the STOP banner"
asserts the output contains `⛔`; after this change that ⛔ comes from
`stopPartial` instead of the inline block, so the test still passes. Run the
test suite after the edit to confirm.

## Acceptance criteria

- [ ] Line 211 reads `if (!result.autoAdvance) parts.push(stopPartial, "")` with
      no `promptState !== "clean"` clause
- [ ] The `autoAdvance` append line is unchanged
- [ ] No other code in the file is changed
- [ ] The test suite passes (in particular `src/Prompt.test.ts` "clean gets the
      STOP banner")
