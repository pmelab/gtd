@inmem
Feature: Retry redirection — a state's entry cap redirects at write time

  Pins `PatternMachine.applyRetry` (see docs/design/pattern-machine-plan.md,
  the `retry` property) through the real CLI: once a `retry`-capped state has
  already been entered `max` times within the current process, the NEXT
  transition that would enter it again is redirected to `otherwise` instead —
  decided at write time, so the redirected label is what actually lands in
  history, not the raw `on`-match target.

  Scenario: repeated check failures redirect to "otherwise" once the cap is reached
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "* **": checking
          checking:
            actor: check
            script: "npm test"
            on:
              "A FEEDBACK.md": fixing
              "C": done
          fixing:
            actor: agent
            retry:
              max: 1
              otherwise: escalate
            prompt: "fix it"
            on:
              "* **": checking
          escalate:
            actor: human
            message: "stuck"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And a file "NOTE.md" with:
      """
      go
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): checking"
    Given a file "FEEDBACK.md" with:
      """
      test failed (attempt 1)
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): fixing"
    Given the file "FEEDBACK.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): checking"
    Given a file "FEEDBACK.md" with:
      """
      test failed (attempt 2)
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): escalate"

  Scenario: a retry cap of 0 redirects on the very first entry attempt
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "* **": checking
          checking:
            actor: check
            script: "npm test"
            on:
              "A FEEDBACK.md": fixing
              "C": done
          fixing:
            actor: agent
            retry:
              max: 0
              otherwise: escalate
            prompt: "fix it"
            on:
              "* **": checking
          escalate:
            actor: human
            message: "stuck"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And a file "NOTE.md" with:
      """
      go
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): checking"
    Given a file "FEEDBACK.md" with:
      """
      test failed
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): escalate"
