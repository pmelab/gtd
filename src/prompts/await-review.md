## Task: Wait for the human to review `REVIEW.md`

`REVIEW.md` exists and is committed, but the human has not recorded any feedback
yet (no edits, no ticked checkboxes). This is a human gate — there is nothing
for the agent to do.

### What the human must do

1. Read `REVIEW.md` and inspect each chunk.
2. Tick every checkbox (`- [ ]` → `- [x]`) once that chunk is accepted.
3. Optionally leave notes inline, edit source files, or drop `!!` follow-up
   comments in the code for anything that needs more work.
4. Re-run gtd once the review is fully worked through.

Report that the review is awaiting human input, then **STOP**. Do not re-run
gtd — the human must act first.
