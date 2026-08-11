@inmem
Feature: Refusals — no-match steps commit nothing

  Pins `PatternMachine.step`'s no-match refusal end to end (see
  docs/design/pattern-machine-plan.md, decision 6): a dirty tree matching none
  of the awaited state's declared patterns is refused naming those patterns.
  `gtd land` derives who acts from the resolved rest itself (see `Edge.ts`'s
  `planStep`), so the pure engine's OTHER refusal shape — out-of-turn — is
  unreachable through it by construction; it stays covered purely at
  `PatternMachine.test.ts`'s level. A refusal exits non-zero and touches no
  history — no commit is ever written for a refused step.

  Scenario: no-match refusal names the declared patterns and commits nothing
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
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    Given I record the commit count
    And a file "scratch.txt" with:
      """
      unrelated pending change
      """
    When I run gtd land
    Then it fails
    And stderr contains "no declared pattern matches"
    And stderr contains "A COMMIT_MSG.md"
    And stderr contains "M COMMIT_MSG.md"
    And the commit count is unchanged

  Scenario: a bare "--entry" with no value is a usage error
    Given a test project
    And the workflow
    When I run gtd with args "--entry"
    Then it fails
    And stderr contains "--entry requires a value"

  Scenario: a second "--entry" occurrence is a usage error, not last-wins
    Given a test project
    And the workflow
    When I run gtd with args "--entry review-gate.check --entry fix-precheck"
    Then it fails
    And stderr contains "--entry may be given at most once"

  Scenario: a duplicate "--var" name is a usage error, not last-wins
    Given a test project
    And the workflow
    When I run gtd with args "--entry review-gate.check --var reviewBase=a --var reviewBase=b"
    Then it fails
    And stderr contains "specified more than once"

  Scenario: "--var" given with no "--entry" is a usage error
    Given a test project
    And the workflow
    When I run gtd with args "--var reviewBase=a"
    Then it fails
    And stderr contains "--var requires --entry"

  Scenario: "--cost" combined with "--entry" is a usage error
    Given a test project
    And the workflow
    When I run gtd with args "--entry review-gate.check --cost=5"
    Then it fails
    And stderr contains "is only valid for `gtd land`"

  Scenario: "--model" combined with "--entry" is a usage error
    Given a test project
    And the workflow
    When I run gtd with args "--entry review-gate.check --cost=5 --model=gpt"
    Then it fails
    And stderr contains "is only valid for `gtd land`"
