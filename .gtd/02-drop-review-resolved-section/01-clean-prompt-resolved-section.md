# Task: Remove the `## Resolved` section from the REVIEW.md format

Pure prompt edit. No machine/edge changes — `REVIEW.md` parsing in `src/Events.ts`
only checks presence/committed/dirty, not section structure.

## Files

- `src/prompts/clean.md` (edit)

Do **not** touch any other file. (If `src/Prompt.test.ts` asserts on the
`## Resolved` text from clean.md, update only that assertion — at the time of
writing it does not; verify with a grep before editing it.)

## What to build

In `src/prompts/clean.md`:

1. In the `REVIEW.md` format example (the fenced ```markdown block, lines ~18-39),
   remove the trailing
   ```
   ## Resolved

   <!-- resolved items move here as the user works through the review -->
   ```
   block so the example ends after the last real chunk.

2. Remove the final bullet (lines ~50-52):
   "**Open/unresolved comments stay at the top** of the file. As the user
   resolves a comment, it **moves** into the `## Resolved` section at the bottom
   — it is not deleted."
   Replace it with simpler guidance: the user checks off / edits items in place
   as they work through the review; there is no separate Resolved section.

Keep everything else (orchestration, chunk-grouping rules, format-normalize step,
re-run guidance) intact.

## Acceptance criteria

- [ ] The `## Resolved` heading and its `<!-- resolved items move here ... -->` comment are gone from the format example
- [ ] The "moves into the `## Resolved` section" bullet is replaced with "check off / edit items in place" guidance
- [ ] No other section of `clean.md` changed
- [ ] No `.ts` source/test changes except a `src/Prompt.test.ts` assertion update if (and only if) one references the removed `## Resolved` clean.md text
- [ ] `npx vitest run` is green
