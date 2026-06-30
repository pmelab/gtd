# Task: Test that the clean prompt carries the review base hash

Add a unit test asserting the rendered **clean** prompt contains the literal
`reviewBase` hash, and reconcile any existing clean-prompt assertions with the
new diff label from task 01.

## What to build

In `src/Prompt.test.ts`, inside the `describe("diff context", …)` block (or a
fitting block):

- Add a case: build the clean prompt with a context whose `reviewBase` is a
  recognizable literal (e.g. `"abc1234def"`) and a non-empty `refDiff`, and
  assert the output `toContain` that literal hash — proving the agent can author
  the `# Review: <short-hash>` / `<!-- base: -->` marker.
- Verify the existing case `clean inlines refDiff under a review heading`
  (~L297) still passes. It asserts `toContain("Changes to review")`,
  `toContain("```diff")`, `toContain("+hello")`. If task 01 changed the diff
  heading text, update this assertion to match (coordinate the exact substring
  with whatever task 01 emits). Prefer keeping `"Changes to review"` present.

## Acceptance criteria

- [ ] New test asserts the rendered clean prompt contains the literal `reviewBase`
- [ ] Existing `clean inlines refDiff under a review heading` test still green
- [ ] `clean renders the clean section`, `{{MODEL}}` substitution, and
      auto-advance clean tests still green
- [ ] `bun test src/Prompt.test.ts` passes against task 01's `src/Prompt.ts`

## Files

- Edit: `/Users/pmelab/Code/gtd/gtd/src/Prompt.test.ts`

## Constraints

- File-disjoint with all other tasks. You own `src/Prompt.test.ts` only.
- This test must pass against the `src/Prompt.ts` produced by task 01 — assert
  the literal hash appears; do not assert a specific surrounding label unless it
  matches task 01's output.
