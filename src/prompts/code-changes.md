## Task: Commit the uncommitted changes

The working tree contains uncommitted changes outside of `TODO.md` (human edits,
source fixes, untracked files, review notes). Commit them verbatim, before any
gate is evaluated.

Stage everything with `git add -A`, then commit. This captures untracked files
too, so nothing the human left behind is lost.

**Important:** Do not commit `TODO.md` in this step. If `TODO.md` has changes,
unstage it (`git restore --staged TODO.md`) and leave it uncommitted — it will
be processed in the planning phase on the next `/gtd` invocation.
