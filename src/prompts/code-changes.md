## Task: Commit uncommitted code changes

The working tree contains uncommitted code changes outside of `TODO.md`.

1. Run the project's full test suite first. If it fails on the current state,
   stop and report the failures — do not commit broken work.
2. Group the uncommitted changes semantically: every logical concern (one
   feature, one bug fix, one refactor, one doc update) is its own group.
3. Stage and commit each group separately with a Conventional Commit message.
   Use `git add -p` or explicit pathspecs to avoid mixing groups.
4. After each commit, re-run the test suite and fix any regressions before
   the next commit.
