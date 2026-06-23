## Task: Commit the uncommitted changes

The working tree contains uncommitted changes outside of `TODO.md` (human edits,
source fixes, untracked files, review notes). Commit them verbatim, before any
gate is evaluated.

Stage everything with `git add -A`, then unstage any control files before
committing. This captures untracked files too, so nothing the human left behind
is lost.

If `TODO.md` is staged, unstage it: `git restore --staged TODO.md` — it will
be processed in the planning phase on the next `/gtd` invocation.

If `REVIEW.md` is staged, unstage it: `git restore --staged REVIEW.md` — it
belongs to the review branch (review-process / await-review), not a code
commit; committing it would strand reviewer feedback.

**Important:** Do not commit `TODO.md` or `REVIEW.md` in this step. Both are
control files managed by separate workflow states and must remain uncommitted
after this commit.
