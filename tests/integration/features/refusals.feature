@inmem
Feature: Refusals — out-of-turn and no-match steps commit nothing

  Pins `PatternMachine.step`'s two refusal shapes (see
  docs/design/pattern-machine-plan.md, decisions 5/6) end to end: a wrong
  invoker is refused out of turn, and a dirty tree matching none of the
  awaited state's declared patterns is refused naming those patterns. Either
  way, a refusal exits non-zero and touches no history — no commit is ever
  written for a refused step.

  Scenario: out-of-turn refusal names the awaited actor and commits nothing
    Given a test project
    And I record the commit count
    When I run gtd step agent
    Then it fails
    And stderr contains "out of turn"
    And stderr contains "awaits human"
    And the commit count is unchanged

  Scenario: no-match refusal names the declared patterns and commits nothing
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "write NOTE.md to start a cycle"
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
    And the last commit subject is "gtd(human): working"
    Given I record the commit count
    And a file "scratch.txt" with:
      """
      unrelated pending change
      """
    When I run gtd step agent
    Then it fails
    And stderr contains "no declared pattern matches"
    And stderr contains "A COMMIT_MSG.md"
    And stderr contains "M COMMIT_MSG.md"
    And the commit count is unchanged
