@inmem
Feature: Derived sessions — sessionId is UUIDv5(memory key), never stored

  `gtd next --json` (peek OR `--dispatch` — both derive the exact same
  answer, since nothing is written; see src/Sessions.ts's own doc comment)
  resolves a `sessionId`/`resume` pair at every `prompt` rest by hashing the
  resting state's memory key (`<scope>#<anchor7>`, src/Edge.ts's
  `memoryKeyFor`) into a UUIDv5. There is no per-scope table anymore: the
  same scope-run always re-derives the same id, and `resume` is `true` iff a
  prior `prompt` rest already landed a turn commit within that same
  scope-run (src/Edge.ts's `memoryResumedFor`).

  Background:
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          child:
            params: [onDone]
            entry: verify
            states:
              verify:
                actor: check
                script: "echo verify"
                on:
                  "C": ask
              ask:
                actor: reviewer
                prompt: "confirm before returning"
                on:
                  "* **": $onDone
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do the work"
                on:
                  "M NOTE.md": working
                  "A CHECKFILE.md": checking
                  "M CHECKFILE.md": checking
              checking:
                machine: child
                with:
                  onDone: working
      """

  Scenario: the same scope-run derives the same id across laps; resume flips false → true once a turn commit lands
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd land
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout matches "\"sessionId\":\"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\""
    And stdout contains "\"resume\":false"
    And I record the json field "sessionId" as "s1"

    Given a file "NOTE.md" with:
      """
      the agent did some work
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And the json field "sessionId" matches the one recorded as "s1"
    And stdout contains "\"resume\":true"

  Scenario: two --dispatch next calls with no step in between derive the SAME id, both resume:false
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd land
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"resume\":false"
    And I record the json field "sessionId" as "first dispatch"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"resume\":false"
    And the json field "sessionId" matches the one recorded as "first dispatch"

  Scenario: a plain --json peek derives the SAME sessionId/resume a --dispatch call would; gtd status --json still omits both
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd land
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"resume\":false"
    And I record the json field "sessionId" as "dispatched"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And the json field "sessionId" matches the one recorded as "dispatched"
    And stdout contains "\"resume\":false"

    When I run gtd status with "--json"
    Then it succeeds
    And stdout does not contain "\"sessionId\""
    And stdout does not contain "\"resume\""

  Scenario: a message rest and a script rest emit neither sessionId nor resume
    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout does not contain "\"sessionId\""
    And stdout does not contain "\"resume\""

    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd land
    Then it succeeds

    Given a file "CHECKFILE.md" with:
      """
      ready
      """
    When I run gtd land
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"checking.verify\""
    And stdout does not contain "\"sessionId\""
    And stdout does not contain "\"resume\""

  Scenario: a nested child machine prompt gets a DIFFERENT id from the parent; on return the parent's id is unchanged with resume:true
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"resume\":false"
    And I record the json field "sessionId" as "the outer session"

    Given a file "CHECKFILE.md" with:
      """
      ready
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → checking.verify"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"checking.verify\""
    And stdout does not contain "\"sessionId\""

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking.verify → checking.ask"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"checking.ask\""
    And stdout contains "\"resume\":false"
    And the json field "sessionId" differs from the one recorded as "the outer session"
    And I record the json field "sessionId" as "the child session"

    Given a file "REVIEW.md" with:
      """
      looks good
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(reviewer): checking.ask → working"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And the json field "sessionId" matches the one recorded as "the outer session"
    And stdout contains "\"resume\":true"

  Scenario: re-entering the child machine a second time derives a DIFFERENT child id — a new scope entry anchors to a new commit
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd land
    Then it succeeds

    Given a file "CHECKFILE.md" with:
      """
      ready
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking.verify → checking.ask"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And I record the json field "sessionId" as "the first child session"

    Given a file "REVIEW.md" with:
      """
      looks good
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(reviewer): checking.ask → working"

    Given a file "CHECKFILE.md" with:
      """
      ready again
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → checking.verify"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking.verify → checking.ask"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"checking.ask\""
    And the json field "sessionId" differs from the one recorded as "the first child session"
