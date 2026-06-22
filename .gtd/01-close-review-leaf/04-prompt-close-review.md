# Add the close-review prompt and wire it into Prompt.ts

Create `src/prompts/close-review.md` and register it so the new leaf renders a
prompt. The prompt discards the ticked working edits, deletes the committed
REVIEW.md, and commits the deletion with the approval message.

## Files

- `src/prompts/close-review.md` — NEW.
- `src/Prompt.ts`
  - imports (`:1-13`) — add `import closeReview from "./prompts/close-review.md"`.
  - `SECTIONS` record (`:16-28`) — add `"close-review": closeReview`. (Because
    `SECTIONS` is typed `Record<LeafState, string>`, this entry is required for
    the project to typecheck once task 03 adds `"close-review"` to `LeafState`.)
- `src/Prompt.test.ts` — add cases (harness `result(...)` / `baseContext(...)`
  at `:5-25`).

## Prompt content (close-review.md)

Mirror the structure of siblings (`human-review.md`, `verified.md`): start with
the SAME "## Test gate (run first)" header block they use (copy it verbatim from
`src/prompts/verified.md:1-11`), then the task. The `<short-sha>` comes from
context `baseRef` (already rendered into the "## Context" block by
`buildContext`); instruct the agent to take the first 7 chars of the base ref
noted in the context / `REVIEW.md`'s `<!-- base: … -->` marker.

Task steps (exact order):

1. `git checkout -- REVIEW.md` — discard the ticked working edits (approval is
   recorded by the commit message, not checkbox noise; matches the
   review-process reset convention and commit `9820256`).
2. `git rm REVIEW.md` — stage the deletion of the committed file.
3. `git commit -m "chore(gtd): close approved review for <short-sha>"` where
   `<short-sha>` is the first 7 chars of the base ref.
4. Auto-advance re-run (the auto-advance partial is appended automatically by
   `buildPrompt` because the leaf is tagged `auto-advance`; do NOT inline the
   partial text — just end the task so the appended partial reads naturally).

The commit message subject MUST be exactly
`chore(gtd): close approved review for <short-sha>` — package 02's
`computeReviewBase` change greps for this exact prefix
(`^chore\(gtd\): close approved review for`).

## Test cases (Prompt.test.ts)

- [ ] `close-review` section renders the commit message
      `chore(gtd): close approved review for` (substring assertion).
- [ ] The short-sha is derived from context `baseRef` — render with
      `result("close-review", { autoAdvance: true, context: { baseRef: "abc1234def" } })`
      and assert the output references the base / instructs taking the first 7
      chars. (Note: `buildContext` does not currently print `baseRef` on its own
      unless `refDiff` is present — verify whether `baseRef` is surfaced; if it
      is not, the prompt must instruct reading the sha from `REVIEW.md`'s
      `<!-- base: -->` marker rather than relying on context. Choose whichever is
      actually available and assert against that.)
- [ ] Includes the auto-advance partial when `autoAdvance` is true
      ("Re-run gtd immediately").
- [ ] Does NOT leak another leaf's section (e.g. assert it does NOT contain
      "Process Review Feedback").

## Acceptance criteria

- [ ] `src/prompts/close-review.md` exists with the test-gate header + the
      checkout/rm/commit steps in the exact order above.
- [ ] `Prompt.ts` imports it and registers `"close-review"` in `SECTIONS`.
- [ ] New `Prompt.test.ts` cases pass; existing prompt tests still pass.
- [ ] Commit subject string in the prompt is exactly
      `chore(gtd): close approved review for <short-sha>`.
