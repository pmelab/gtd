Feature: gtd land — the one landing verb, actorless — the exit-code contract

  `gtd land` derives who acts from the resolved rest itself — no actor
  argument, no `--if-resting`. This pins the exit-code contract a driver
  relies on: 0 for an ordinary landing (capture, turn, attempt, squash, or a
  benign no-op at a clean `message` rest), 3 for SETTLED (nothing owed, but
  stdout still carries a script to run), 1 for a refusal or usage error
  (nothing emitted). `gtd step <actor>` is removed outright; `--entry` is only
  the bare `gtd --entry <state>` form.

  @inmem
  Scenario: a capture exits 0 and lands
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
                prompt: "do it"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then the exit code is 0
    And the last commit subject is "gtd(human): idle → working"

  @inmem
  Scenario: a clean message rest exits 0 printing nothing to do
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
                prompt: "do it"
      """
    When I run gtd land
    Then the exit code is 0
    And stdout contains "nothing to do at \"idle\""

  @inmem
  Scenario: a clean script rest SETTLES and still prints its note
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
                  "* **": checking
              checking:
                actor: check
                script: "true"
                on:
                  "A OUT.txt": idle
      """
    And a commit "gtd(check): checking" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then the exit code is 3
    And stdout contains "nothing to do at \"checking\""

  @inmem
  Scenario: the green --entry fix-precheck collapse SETTLES with the commit count unchanged
    Given a test project
    And the workflow
    And I record the commit count
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    When I run gtd land
    Then the exit code is 3
    And the commit count is unchanged
    And the git log does not contain "gtd("

  @inmem
  Scenario: a dirty no-match exits 1 authoring nothing
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
                  "A NOTE.md": working
              working:
                actor: agent
                prompt: "do it"
      """
    And a file "scratch.txt" with:
      """
      an unrelated pending change
      """
    And I record the commit count
    When I run gtd land
    Then the exit code is 1
    And stderr contains "no declared pattern matches"
    And the commit count is unchanged

  @inmem
  Scenario: gtd land human is an arity error
    Given a test project
    When I run gtd land with "human"
    Then the exit code is 1
    And stderr contains "too many arguments"

  @inmem
  Scenario: gtd step human prints the REMOVED pointer instead of an unknown-command error
    Given a test project
    When I run gtd with args "step human"
    Then the exit code is 1
    And stderr contains "gtd step <actor>"
    And stderr contains "gtd land"
    And stderr contains "gone"

  @inmem
  Scenario: --json carries script/required/optional/settled
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
                prompt: "do it"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land with "--json"
    Then the exit code is 0
    And stdout contains "\"script\":"
    And stdout contains "\"required\":"
    And stdout contains "\"optional\":"
    And stdout contains "\"settled\":false"

  @live
  Scenario: gtd land | bash lands the turn in one pipe
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
                prompt: "do it"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land piped to bash
    Then the exit code is 0
    And the last commit subject is "gtd(human): idle → working"
