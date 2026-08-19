@live
Feature: Honoring $TMPDIR and $GIT_DIR — gtd assumes nothing about /tmp or <cwd>/.git

  gtd makes no assumption about where the OS's scratch space or a repository's
  git dir live: no production code names "/tmp" or shells out to `mktemp`
  (see tests/tooling/no-tmp-assumption.test.ts), and every git subprocess gtd
  spawns inherits the ambient environment untouched, so a `$GIT_DIR`/`$TMPDIR`
  set on the invoking environment is honored by construction.
  `src/WorktreeState.ts`'s `loopLogPath` was the one deliberate exception — it
  read `<root>/.git` off the filesystem specifically so a stray `$GIT_DIR`
  couldn't divert it — and now honors `$GIT_DIR` too, at the accepted cost
  that an INHERITED `$GIT_DIR` moves the log path along with it. The test
  process itself never exports `$GIT_DIR` (hooks.ts scrubs it once at
  load time); only the spawned `gtd` under test sees the relocated values.

  Scenario: a full beat lands correctly with the git dir relocated outside the worktree and TMPDIR pointed elsewhere
    Given a test project
    And the workflow
    And a file "src/feature.ts" with:
      """
      export const feature = 1
      """
    And the repo's git dir relocated outside the worktree, with TMPDIR pointed at a fresh scratch directory
    When I run gtd land
    Then it succeeds
    And the last commit in the relocated git dir has subject "gtd(human): idle → unwind"
    And the repository's default ".git" directory was never recreated
    And nothing was written under the overridden TMPDIR
    And gtd status --json reports the log path under the relocated git dir
