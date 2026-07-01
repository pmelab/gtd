# Update await-review prompt and add STOP constraint test

## Description

Harden the await-review prompt so agents cannot self-approve reviews. Two
changes:

1. Rewrite `src/prompts/await-review.md` to lead with a ⛔ STOP block before the
   task heading, explicitly stating that re-running gtd with a clean tree will
   auto-approve the review without human input.
2. Add a test in `src/Prompt.test.ts` asserting the STOP text is present and
   precedes the task heading.

## Files

- `src/prompts/await-review.md` — replace entire content
- `src/Prompt.test.ts` — add new `it(...)` block alongside the existing
  `"await-review renders the await-review section"` test

## New prompt content (`src/prompts/await-review.md`)

```markdown
⛔ **STOP — do not re-run `gtd`.** Running `gtd` now with no edits will
auto-approve the review and commit `gtd: done` without human input. Only the
user may resume this step.

## Task: Await the user's review

`REVIEW.md` has been committed (`gtd: awaiting review`). This is a human gate —
there is nothing for the agent to do.

Tell the user to:

1. Read `REVIEW.md` and walk through each chunk, inspecting the referenced
   files.
2. **To approve** — re-run gtd with **no** changes **or after only checking off
   REVIEW.md checkboxes**. gtd treats checkbox-only edits as approval and
   finishes the review (`gtd: done`).
3. **To request changes** — edit the code, leave inline comments, or make
   non-checkbox textual edits to `REVIEW.md`, then re-run gtd. gtd captures
   those changes as the seed of a new plan and re-enters grilling.
```

## New test (`src/Prompt.test.ts`)

Add this `it(...)` block alongside the existing
`"await-review renders the await-review section"` test:

```typescript
it("await-review leads with the STOP constraint", () => {
  const out = buildPrompt(result("await-review"))
  expect(out).toContain("STOP — do not re-run `gtd`")
  expect(out).toContain("auto-approve the review")
  // constraint must appear before the task heading
  expect(out.indexOf("STOP — do not re-run")).toBeLessThan(
    out.indexOf("Await the user's review"),
  )
})
```

## Acceptance criteria

- [ ] `src/prompts/await-review.md` starts with the ⛔ STOP block (before any
      `##` heading)
- [ ] The STOP block contains "STOP — do not re-run `gtd`" and "auto-approve the
      review"
- [ ] `src/Prompt.test.ts` includes the new
      `"await-review leads with the STOP constraint"` test
- [ ] All existing tests still pass (`npm test`)
- [ ] New test passes
