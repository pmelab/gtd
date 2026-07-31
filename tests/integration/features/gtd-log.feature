@live
Feature: gtd log — opening the current loop's log file in the editor

  `bin/gtd log` (see bin/gtd's own dispatch comment, alongside `gtd edit`) is a
  bash-level convenience command, dispatched before anything reaches the
  bundle: it opens `${VISUAL:-$EDITOR}` on the current repo/worktree's loop
  logfile, resolved the same way the loop itself resolves it —
  `"$(worktree_git_dir)/gtd-loop.log"`, or `$GTD_LOOP_LOG` verbatim when set.
  `worktree_git_dir` derives the git dir from the cwd with GIT_DIR/GIT_WORK_TREE
  scrubbed, so an inherited GIT_DIR can never key the log to a DIFFERENT
  worktree (two concurrently looping worktrees must not collide on one log). It
  takes no arguments, and refuses rather than opening an empty buffer when no
  loop has produced a log yet.

  Scenario: gtd log refuses when no loop has produced a log yet
    Given a test project
    When I run "log" via gtd
    Then it fails
    And the exit code is 1
    And stderr contains "no loop log yet at"

  Scenario: gtd log opens the current run's log file in the editor
    Given a test project
    And a file ".git/gtd-loop.log" with:
      """
      📄 log: .git/gtd-loop.log
      🤖 a previous run's agent turn output
      """
    And $EDITOR is a script that appends "reviewed the log" to the opened file
    When I run "log" via gtd
    Then it succeeds
    And the fake editor was opened on ".git/gtd-loop.log"
    And ".git/gtd-loop.log" contains "reviewed the log"

  Scenario: gtd log respects GTD_LOOP_LOG when set
    Given a test project
    And GTD_LOOP_LOG is set to "notes/custom.log"
    And a file "notes/custom.log" with:
      """
      a previous run's log, at a custom path
      """
    And $EDITOR is a no-op script
    When I run "log" via gtd
    Then it succeeds
    And the fake editor was opened on "notes/custom.log"

  Scenario: gtd log keys the log to this worktree, ignoring an inherited GIT_DIR
    Given a test project
    And GIT_DIR points at a separate git dir
    And a file ".git/gtd-loop.log" with:
      """
      this worktree's own loop log
      """
    And $EDITOR is a no-op script
    When I run "log" via gtd
    Then it succeeds
    And the fake editor was opened on ".git/gtd-loop.log"

  Scenario: an inherited GTD_LOOP_LOG from an outer loop driver never leaks into a spawned gtd
    # When the suite runs AS a gtd loop's own check, the driver has exported
    # GTD_LOOP_LOG (the outer worktree's log path). A spawned gtd must resolve
    # ITS OWN log, not inherit the driver's — else every log-path assertion
    # breaks. The harness strips inherited GTD_LOOP_* at the spawn boundary.
    Given a test project
    And the loop driver leaked GTD_LOOP_LOG as "/somewhere/else/.git/gtd-loop.log"
    And a file ".git/gtd-loop.log" with:
      """
      this repo's own loop log
      """
    And $EDITOR is a no-op script
    When I run "log" via gtd
    Then it succeeds
    And the fake editor was opened on ".git/gtd-loop.log"

  Scenario: gtd log rejects an extra argument as a usage error, never opening the editor
    Given a test project
    And $EDITOR is a script that appends "should never be seen" to the opened file
    When I run "log extra" via gtd
    Then the exit code is 2
    And stderr contains "gtd log: takes no arguments"
    And the fake editor was not invoked
