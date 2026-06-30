## Task: Create `REVIEW.md` for the finished work

The working tree is clean and there is unreviewed work since the review base.
Produce a `REVIEW.md` that guides the user through it. The diff to review
(`git diff <base> HEAD`) is inlined below.

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

   ## Resolved

   <!-- resolved items move here as the user works through the review -->
   ```

   - `<short-hash>` is the first 7 characters of the review base SHA; `<full-hash>`
     is the full SHA. Both are read from the `Review base:` line / diff label in
     the prompt context.
   - Chunk titles are short imperative phrases (≤ 6 words).
   - Explanations describe _what_ changed and _why_, not just where.
   - File pointers are relative, prefixed with `./`; the line numbers (`#42`)
     are creation-time hints that will drift — not authoritative.
   - Checkboxes (`- [ ]`) are **navigational aids** — they help the user track
     progress, not a gate.
   - **Open/unresolved comments stay at the top** of the file. As the user
     resolves a comment, it **moves** into the `## Resolved` section at the
     bottom — it is not deleted.

4. Normalize formatting (run `gtd format REVIEW.md` with the same gtd you
   invoked), then leave `REVIEW.md` **uncommitted**.

Re-run gtd — the next cycle commits `REVIEW.md` as `gtd: awaiting review` and
stops for the user. The user then re-runs gtd with **no** changes to approve and
finish, or edits the code / annotates `REVIEW.md` to request changes (which seed
a fresh plan).
