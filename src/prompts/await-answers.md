## Task: Wait for the human to answer the open questions in `TODO.md`

`TODO.md` is being grilled (HEAD is `plan(gtd): grilling`) and still has
unanswered questions under `## Open Questions`. This is a human gate — the plan
cannot advance until the questions are answered.

### What the human must do

1. Open `TODO.md` and read each question under `## Open Questions`.
2. Write the answer inline beneath each question (replacing the
   `<!-- user answers here -->` placeholder).
3. Re-run gtd. The next cycle commits the answers verbatim and re-grills the
   plan, moving resolved questions into `## Resolved`.

Report that the plan is awaiting answers, then **STOP**. Do not re-run gtd — the
human must answer first.
