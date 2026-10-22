@live
Feature: the run-gtd skill's worked example — doc-tested

  .claude/skills/run-gtd/SKILL.md tells an agent or a person how to test a gtd
  change by hand, and ends in a worked example: one paste that starts a
  process in a scratch repository, reaches a human rest and lands an answer.
  Nothing else runs that paste, so it is extracted verbatim and run with only
  $PATH (this build's `gtd` first) and $HOME, the way the skill's build step
  leaves a shell.

  Scenario: The worked example starts a process, rests at the answer gate and lands an answer
    Given a test project
    And the bash block under "## Worked example" in ".claude/skills/run-gtd/SKILL.md"
    When I run the pasted script
    Then it succeeds
    And stdout contains "Awaiting your product answers"
    And stdout contains "design.gate.answer → design.triage"
