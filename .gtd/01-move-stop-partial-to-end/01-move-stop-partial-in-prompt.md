# Move stop partial to end of prompt in `src/Prompt.ts`

Mirror the `auto-advance` pattern: append `stopPartial` after all content
sections instead of right after the header.

## Description

In `buildPrompt` (`src/Prompt.ts`), the `stopPartial` banner is currently pushed
early, immediately after the header (line 174), so it renders _before_ the
context block and task content. Move it to the end so it renders _after_ all
content, exactly mirroring how `autoAdvance` is appended.

## Changes

1. Remove the early push at line 174 (and its preceding TODO comment, if
   present):

   ```ts
   if (!result.autoAdvance && promptState !== "clean")
     parts.push(stopPartial, "")
   ```

   Leaving line 173 (`const parts: Array<string> = [header, ""]`) followed
   directly by line 175 (`parts.push(buildContextBlock(context))`).

2. Immediately _before_ the existing auto-advance append at the end of
   `buildPrompt` (currently line 212):

   ```ts
   if (result.autoAdvance) parts.push(autoAdvance, "")
   ```

   add the moved line, so the tail reads:

   ```ts
   if (!result.autoAdvance && promptState !== "clean")
     parts.push(stopPartial, "")
   if (result.autoAdvance) parts.push(autoAdvance, "")
   ```

   Keep the guard condition byte-for-byte identical to the original — only its
   position changes.

## Acceptance criteria

- [ ] The early `parts.push(stopPartial, "")` at line ~174 is removed
- [ ] The TODO comment associated with that early push (if any) is removed
- [ ] The `stopPartial` push now appears immediately before the `autoAdvance`
      push at the end of `buildPrompt`, with the same guard condition
- [ ] `stopPartial` and `autoAdvance` are mutually exclusive by their guards
      (`!result.autoAdvance` vs `result.autoAdvance`), so ordering between the
      two lines is inconsequential — but placement mirrors auto-advance
- [ ] No other logic in `buildPrompt` changes

## Files

- `src/Prompt.ts` — `buildPrompt` function (lines ~165–219)

## Constraints / edge cases

- The `clean` state must still never get the STOP banner (guard keeps
  `promptState !== "clean"`).
- This task and `02-update-stop-banner-assertions.md` run in parallel and are
  file-disjoint (this touches `src/Prompt.ts`, that touches
  `src/Prompt.test.ts`). Both are required for the suite to stay green.
