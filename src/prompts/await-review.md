## Task: Await the user's review

`REVIEW.md` has been committed (`gtd: awaiting review`). This is a human gate —
there is nothing for the agent to do.

Tell the user to:

1. Read `REVIEW.md` and walk through each chunk, inspecting the referenced
   files.
2. **To approve** — re-run gtd with **no** changes. gtd reads the absence of
   edits as approval and finishes the review (`gtd: done`).
3. **To request changes** — edit the code, leave inline comments, or annotate
   `REVIEW.md`, then re-run gtd. gtd captures those changes as the seed of a new
   plan and re-enters grilling.

Report that the review is awaiting the user, then **STOP**. Do not re-run gtd
yourself — the user must act first.
