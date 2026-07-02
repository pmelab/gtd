## Task: Create `REVIEW.md` for the finished work

The working tree is clean and there is unreviewed work since the review base.
Produce a `REVIEW.md` that guides the user through it. The diff to review
(`git diff <base> HEAD`) is inlined below; workflow files (REVIEW.md, TODO.md,
FEEDBACK.md, ERRORS.md, `.gtd/`) are already excluded — never write review
chunks about them.

### Orchestration

Spawn a **planning-model subagent** using model `{{MODEL}}` to author the
review. It must:

1. **Read the inlined diff** — extract the changed hunks with their file paths.
2. **Group hunks semantically** — cluster hunks that serve the same logical
   concern (the same feature, refactor, or fix), even across files. Aim for the
   fewest chunks that keep the review navigable.
3. **Write `REVIEW.md`** in the repo root in this format:

   ```markdown
   # Review: <short-hash>

   <!-- base: <full-hash> -->

   ## <Chunk Title>

   <What this chunk changes and why>

   - [ ] ./path/to/file.ts#42
   - [ ] ./path/to/file.ts#99

   ## <Another Chunk Title>

   <Explanation>

   - [ ] ./path/to/another.ts#1
   ```

   - `<short-hash>` is the first 7 characters of the review base SHA;
     `<full-hash>` is the full SHA. Both are read from the `Review base:` line /
     diff label in the prompt context.
   - Chunk titles are short imperative phrases (≤ 6 words).
   - Explanations describe _what_ changed and _why_, not just where.
   - File pointers are relative, prefixed with `./`; the line numbers (`#42`)
     are creation-time hints that will drift — not authoritative.
   - Checkboxes (`- [ ]`) signal approval — ticking them (with no other edits)
     counts as approving the review (`gtd: done`). Only non-checkbox edits to
     `REVIEW.md` (or any code edits) are treated as a change-request.
   - The user checks off or edits items in place as they work through the
     review; there is no separate Resolved section.

4. Normalize formatting (run `gtd format REVIEW.md` with the same gtd you
   invoked), then leave `REVIEW.md` **uncommitted**.

Tell the user `REVIEW.md` is ready and that they should run `gtd` to proceed to
the review.
