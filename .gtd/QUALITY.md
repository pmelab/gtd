## correctness: the restack rollback trusts its own steps

`claude/hooks/ship.ts` `restackOf` → `run`, backstop loop (~l.1027-1046).

- The rollback calls `ok("update-ref", …)` per lower branch and
  `ok("reset", "--keep", preHead)`, discards both results, then reports "the
  restack is undone and nothing was pushed or recorded". A failed `update-ref`
  (ref lock) or `reset --keep` leaves the slice branches rebased while the
  record stays as it was. That is the broken chain the backstop exists to
  prevent: the next ship silently drops the stack, and the message has already
  said nothing changed. Check each result and, on failure, say which ref is
  still rebased, giving the `git update-ref` / `git reset --keep` line to run by
  hand.
- `--update-refs` moves every local ref that points into `<from>..<branch>`, not
  only the slice branches (a backup branch on a slice commit, say). The rollback
  restores only `lower` and HEAD, so "undone" overstates what it did for those
  refs. FYI. Narrow the claim, or snapshot `git for-each-ref refs/heads` before
  the rebase.
- The test cannot catch a broken restore. `three` has one lower branch and
  scripts `git rev-parse refs/heads/feat/x-middle` to `S2` before and after the
  rebase, so the asserted `git update-ref refs/heads/feat/x-middle S2 S2` still
  passes with the old/new arguments swapped, or with `pre` read after the
  rebase. No case restores a lower branch that DID move while another was
  skipped, which is the point of the rollback. Add a four-slice case (two lower
  branches): the rebase moves one and skips the other, and the test asserts
  `update-ref <moved> <pre-sha> <post-sha>` with distinct shas.

## correctness: the worktree precheck misses a branch mid-rebase elsewhere

`checkedOutElsewhere` reads only `branch refs/heads/<b>` lines from
`git worktree list --porcelain`. I checked this against real git 2.54: a
worktree in the middle of a rebase (or bisect) of `feat/x-middle` lists as
`detached`, so the precheck passes. `git rebase --update-refs` still skips that
branch: the rebase exited 0 and `feat/x-middle` stayed put. The backstop catches
it, so no stack is lost. But:

- the refusal is the backstop's version, with no worktree path, because the same
  parser finds nothing to name
- with a squash earlier in the same run, the squash is kept, which contradicts
  "refuses, with nothing changed" in `README.md` and `docs/driver.md` for "a
  slice branch checked out in another worktree"

Non-blocking. Either parse the rebase/bisect state of each worktree (its
`rebase-merge/head-name`), or soften the docs to "checked out (or being rebased)
in another worktree" and accept the backstop path.

## correctness: new io argv tested only against the scripted fake

FYI, mock/live drift. `git worktree list --porcelain` parsing,
`git rev-parse --git-path rebase-merge` + `test -d`, the explicit-refspec fetch
and the silent skip by `--update-refs` that the backstop relies on are all
pinned only by `ship.test.ts`'s scripted repository. No test runs any of them
against real git. The fake answers every unscripted argv with exit 0 and empty
output, so any failing-rebase test that scripts `GITPATH` takes "rebase in
progress" for granted. A real-git check (above) confirms the parser's format,
the relative `.git/rebase-merge` resolved from the root `cwd`, and the skip, so
nothing drifts today. Nothing would flag it if a later git changed any of these.
A small real-git contract case covering the skip, the backstop and the rollback
would close the gap.
