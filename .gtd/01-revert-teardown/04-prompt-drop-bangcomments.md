# Prompt.ts: remove the `bangComments` injection block

Remove the Context-builder block that injected harvested `!!` follow-up comments.
With `bangComments` gone from `GtdContext` (Machine task) and never populated
(Events task), this block is dead and would not compile.

This task owns BOTH `src/Prompt.ts` and `src/Prompt.test.ts`.

## Files (exclusive to this task)

- `src/Prompt.ts`
- `src/Prompt.test.ts`

## What to do — `src/Prompt.ts`

- In `buildContext`, delete the entire `if (context.bangComments && …)` block
  (~88-96), including its heading `"### \`!!\` follow-up comments (leftover work to harvest)"`
  and the per-comment loop. Leave the surrounding `refDiff` block (~79-87) and
  the `diff` block (~98-105) intact, and keep the lone `lines.push("")` at ~97
  (or remove a now-redundant blank push only if the join output is unchanged —
  prefer the minimal deletion that compiles and keeps spacing sane).

## What to do — `src/Prompt.test.ts`

- The `review-process` content test (~57-61) currently asserts
  `format TODO.md` and `TODO:`. Update it to assert the NEW teardown text instead
  of any injected `!!` section:
  - keep `expect(out).toContain("format TODO.md")`
  - replace/augment with `expect(out).toContain("git revert --no-edit")`
  - DROP the `expect(out).toContain("TODO:")` assertion (the prompt no longer
    references plain `TODO:` markers after the rewrite).

  NOTE: the asserted strings (`git revert --no-edit`, `format TODO.md`) come from
  the rewritten `src/prompts/review-process.md` (sibling task in this package).
  Both land in the same commit, so this test passes once both are applied. If the
  exact wording differs, match the sibling task's final prompt text.
- There is no `bangComments` injection assertion to remove (the existing test did
  not assert it), but confirm no test references `bangComments` or the harvested
  `!!` section heading.

## Constraints

- Do NOT change `renderPackage`, `fenceFor`, model injection, or any other part
  of `Prompt.ts`.
- `npm run test` must pass for the package as a whole.

## Acceptance criteria

- [ ] The `bangComments` injection block is removed from `buildContext`; no
      `bangComments` reference remains in `src/Prompt.ts`.
- [ ] The `review-process` prompt test asserts `git revert --no-edit` and
      `format TODO.md`, and no longer asserts `TODO:`.
- [ ] No test references the `!!` follow-up comments injection heading.
