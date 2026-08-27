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
    And gtd next --json reports the log path under the relocated git dir

  Scenario: the emitted validate script may write under TMPDIR while gtd itself still writes nothing there
    # Package 2's mode-contradiction round-trip (src/ModeContradiction.ts,
    # src/program.ts's scratchSamplePath) writes a scratch sample under
    # $TMPDIR — but only the EMITTED SCRIPT does that, once a driver runs it;
    # gtd the process still names no "/tmp" literal and calls no mktemp (see
    # tests/tooling/no-tmp-assumption.test.ts). Inspected via the unexecuted
    # `gtd next --json=validate` script text, since the round-trip cleans its
    # own scratch file up on every path (success or failure) and leaves
    # nothing on disk afterwards either way — a raw, unexecuted script is the
    # only place the reference to $TMPDIR is ever observable.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          review:
            format: "true"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                file: REVIEW.md
                mode: review
                prompt: "review"
                on:
                  "* **": idle
      """
    And an empty commit "gtd(human): reviewing"
    And the repo's git dir relocated outside the worktree, with TMPDIR pointed at a fresh scratch directory
    When I run gtd next with "--json=validate"
    Then it succeeds
    And stdout contains the overridden TMPDIR path
    And nothing was written under the overridden TMPDIR
