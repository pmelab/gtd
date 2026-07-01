# Strip the bespoke STOP block from `await-review.md`

Remove the existing ⛔ paragraph (lines 1–3) from `src/prompts/await-review.md`.
After package 3 lands the central injection, `await-review.md` no longer needs
its own STOP banner. This package strips it in advance so the file is clean
before the wiring step.

## Acceptance criteria

- [ ] `src/prompts/await-review.md` no longer starts with the ⛔ paragraph
- [ ] `src/prompts/await-review.md` now begins with
      `## Task: Await the user's review`
- [ ] The body of the section (items 1–3 under the heading) is unchanged
- [ ] All existing tests remain green after this change

  **Note**: the test `"await-review leads with the STOP constraint"` checks for
  `"STOP — do not re-run \`gtd\`"`and`"auto-approve the
  review"`. After stripping, the `auto-approve the review` text is gone and the
  STOP text will also be absent — this test will **fail** until package 4
  updates the assertions. That is acceptable per the dependency order: package 4
  fixes the tests. However, packages 1–2 must each leave _their own_ changed
  files internally consistent; the test breakage here is resolved by package 4,
  not by this package.

  If you need the suite green after this package alone, temporarily skip only
  `"await-review leads with the STOP constraint"` and note it for package 4 to
  restore.

## Files

- **Modify**: `src/prompts/await-review.md`

## Constraints / edge cases

- Remove only lines 1–3 (the ⛔ paragraph and its trailing blank line). Do not
  alter the heading or task description below it.
- Current lines 1–3 of `await-review.md`:
  ```
  ⛔ **STOP — do not re-run `gtd`.** Running `gtd` now with no edits will
  auto-approve the review and commit `gtd: done` without human input. Only the
  user may resume this step.
  ```
  (followed by a blank line, then `## Task: Await the user's review`)
- Do NOT touch `src/Prompt.ts` or `src/Prompt.test.ts` in this package.
