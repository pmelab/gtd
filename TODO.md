# Move STOP partial to end of prompt

Mirror the `auto-advance` pattern: append `stopPartial` after all content
sections instead of right after the header.

## Work packages

### WP1: Move stop partial in `src/Prompt.ts`

- Remove the TODO comment and the early `stopPartial` push at line 174
- Add
  `if (!result.autoAdvance && promptState !== "clean") parts.push(stopPartial, "")`
  immediately before `if (result.autoAdvance) parts.push(autoAdvance, "")` at
  the end of `buildPrompt` (line 212), mirroring the `auto-advance` pattern
  exactly

### WP2: Update position-check assertions in `src/Prompt.test.ts`

Three tests in the `"STOP banner"` describe block assert that `⛔` appears
_before_ the task heading (using `toBeLessThan`). After the move, `⛔` appears
_after_ all content, so flip each `toBeLessThan` to `toBeGreaterThan`:

- line 201:
  `expect(out.indexOf("⛔")).toBeLessThan(out.indexOf("Escalate — the test gate"))`
  → `toBeGreaterThan`
- line 207:
  `expect(out.indexOf("⛔")).toBeLessThan(out.indexOf("Nothing to do"))` →
  `toBeGreaterThan`
- line 214:
  `expect(out.indexOf("⛔")).toBeLessThan(out.indexOf("Open questions await the user"))`
  → `toBeGreaterThan`

Also update the inline comment on the `await-review` test at line 93:

- line 93–95: comment says "constraint must appear before the task heading" and
  uses `toBeLessThan` for `"STOP — do not re-run"` vs
  `"Await the user's review"` → flip comment to "constraint must appear after
  all content" and change to `toBeGreaterThan`

no open questions — run gtd to plan
