## Task: Review is incomplete — human must finish it

`REVIEW.md` exists and the human has started reviewing (some edits were made),
but at least one checkbox is still unticked. This is a human gate — there is
nothing for the agent to do until the review is complete.

This state is distinct from `await-review`: there the review has not been
touched at all; here the human has engaged but left work unfinished.

### What the human must do

1. Re-read every section of `REVIEW.md`.
2. Tick **every** remaining checkbox (`- [ ]` → `- [x]`) once that chunk is
   accepted.
3. Optionally leave notes inline or edit source files for anything that needs
   further work before accepting.
4. Re-run gtd only after all checkboxes are ticked.

Report that the review is incomplete and is awaiting the human to finish it,
then **STOP**. Do not re-run gtd — the human must act first.
