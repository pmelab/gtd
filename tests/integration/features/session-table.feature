@inmem
Feature: The per-scope session table — gtd next --json --dispatch mints/resumes sessionId+resume

  `gtd next --json --dispatch` (only the dispatched form; plain
  `gtd next [--json]`/`gtd status --json` stay read-only peeks — see
  src/Sessions.ts's own doc comment) resolves a `sessionId` + `resume` pair at
  every `prompt` rest, backed by a per-scope table in the git dir
  (`src/DriverState.ts`/`src/Sessions.ts`). A row starts `"fresh"` (minted by
  a dispatch, not yet safe to resume) and is promoted to `"used"` only once
  `gtd step <actor>` confirms the dispatch for that same actor — so
  dispatching more than once per beat (a crashed driver relaunching, a custom
  loop) can never resume an id nobody dispatched.

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
                  "C": $onDone
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
                  "A CHECKFILE.md": checking
              checking:
                machine: child
                with:
                  onDone: working
      """

  Scenario: a prompt rest mints a fresh sessionId with resume:false, and a step confirms it so the next lap resumes it
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd step human
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout matches "\"sessionId\":\"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\""
    And stdout contains "\"resume\":false"
    And I record the json field "sessionId" as "s1"

    When I run gtd step agent
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And the json field "sessionId" matches the one recorded as "s1"
    And stdout contains "\"resume\":true"

  Scenario: a plain --json peek omits sessionId/resume even at a prompt rest
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd step human
    Then it succeeds

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout does not contain "\"sessionId\""
    And stdout does not contain "\"resume\""

  Scenario: two dispatches with no step in between mint DIFFERENT ids, both resume:false
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd step human
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"resume\":false"
    And I record the json field "sessionId" as "first peek"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"resume\":false"
    And the json field "sessionId" differs from the one recorded as "first peek"

  Scenario: gtd status --json between beats changes nothing
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd step human
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"resume\":false"
    And I record the json field "sessionId" as "beat"

    When I run gtd step agent
    Then it succeeds

    When I run gtd status with "--json"
    Then it succeeds
    And stdout does not contain "\"sessionId\""

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And the json field "sessionId" matches the one recorded as "beat"
    And stdout contains "\"resume\":true"

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
    When I run gtd step human
    Then it succeeds

    Given a file "CHECKFILE.md" with:
      """
      ready
      """
    When I run gtd step agent
    Then it succeeds

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"checking.verify\""
    And stdout does not contain "\"sessionId\""
    And stdout does not contain "\"resume\""

  Scenario: a nested child machine's own excursion doesn't disturb the parent's resumable session
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd step human
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
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): working → checking.verify"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"checking.verify\""
    And stdout does not contain "\"sessionId\""

    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): checking.verify → working"

    When I run gtd next with "--json" and "--dispatch"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And the json field "sessionId" matches the one recorded as "the outer session"
    And stdout contains "\"resume\":true"
