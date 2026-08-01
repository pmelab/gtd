@live
Feature: A red check writes feedbackFile even when it lives outside stateDir

  The check scripts (`src/workflows/unified.yaml`) used to only ensure the
  scratch directory (`.gtd`) existed (`mkdir -p .gtd`) before writing the
  feedback file into it — fine while `feedbackFile` stayed under that same
  directory, but once it is repointed elsewhere (a `vars:` override, e.g. a
  nested `notes/FEEDBACK.md` whose parent directory was never created), the
  write's redirection fails silently: the shell command errors out before
  `printf` runs, the tree stays clean, and the check step wrongly reads that
  as a passing suite (`checking`'s "C" pattern routes to `reviewing`) instead
  of surfacing the failure. The fix adds a `mkdir -p "$(dirname "$feedback")"`
  right after hoisting the feedback path, so a relocated feedbackFile's parent
  directory is created regardless of where it lives — `stateDir` stays at its
  default (`.gtd`) so the scratch check-output file still lands there
  unaffected.

  This scenario actually EXECUTES the rendered script (`I execute the printed
  check script`) rather than simulating its outcome by hand — the bug lives in
  the script's own shell logic, which `@inmem` scenarios never run (see
  AGENTS.md and review-signoff-outside-gtd.feature, which covers the same
  class of bug for `reviewFile`/issue #128).

  Scenario: a red check writes the relocated feedbackFile and routes to fixing, not reviewing
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        feedbackFile: notes/FEEDBACK.md
        testCommand: "false"
      """
    And a commit "gtd(agent): building → checking" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    And I execute the printed check script
    And I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking → fixing"
