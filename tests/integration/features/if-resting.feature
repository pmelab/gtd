@inmem
Feature: gtd step <actor> --if-resting — idempotent opening capture

  pmelab/gtd#168: `--if-resting` suppresses `PatternMachine.step`'s
  `"out-of-turn"` refusal — a wrong-actor step exits 0 doing nothing instead
  of refusing — so a driver's opening move can be one unconditional
  `gtd step human --if-resting`, whether it lands on a fresh gate or resumes
  a mid-process restart. Every OTHER refusal (a `"no-match"` on a dirty tree,
  or a step-capture guard refusing a malformed steering file) still fails
  loudly — the flag reaches neither.

  Scenario: --if-resting suppresses the out-of-turn refusal as a no-op
    Given a test project
    And the workflow
    And I record the commit count
    When I run gtd step agent with "--if-resting"
    Then it succeeds
    And stdout contains "nothing to do"
    And the commit count is unchanged

  Scenario: --if-resting still captures when it IS the invoker's turn
    Given a test project
    And the workflow
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human with "--if-resting"
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-gate.check"

  Scenario: a no-match refusal on a dirty tree still fails with --if-resting
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "develop the note, then write COMMIT_MSG.md with the final message"
                on:
                  "A COMMIT_MSG.md": done
                  "M COMMIT_MSG.md": done
              done:
                commit: '<%~ it.read("COMMIT_MSG.md") %>'
      """
    And a file "NOTE.md" with:
      """
      Remember the milk.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    Given I record the commit count
    And a file "scratch.txt" with:
      """
      unrelated pending change
      """
    When I run gtd step agent with "--if-resting"
    Then it fails
    And stderr contains "no declared pattern matches"
    And the commit count is unchanged

  Scenario: a step-capture guard refusal (malformed steering file) still fails with --if-resting
    Given a test project
    And the workflow
    And a commit "gtd(human): design.product-answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. Plan: do it.
      """
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a thing. Plan: do it.

      ## Open Questions

      ###

      The human deleted the question text.
      """
    When I run gtd step human with "--if-resting"
    Then it fails
    And stderr contains "has no question text"
    And the last commit subject is "gtd(human): design.product-answer"
