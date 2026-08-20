@inmem
Feature: Derived sessions — session.id is UUIDv5(memory key), never stored

  `gtd next --json` (a pure peek, called once or twice back to back — both
  derive the exact same answer, since nothing is written; see
  src/Sessions.ts's own doc comment) resolves a `session: {id, resume}` pair
  at every `prompt` rest by hashing the resting state's memory key
  (`<scope>#<anchor7>`, src/Edge.ts's `memoryKeyFor`) into a UUIDv5. There is
  no per-scope table anymore: the same scope-run always re-derives the same
  id, and `resume` is `true` iff a prior `prompt` rest already landed a turn
  commit within that same scope-run (src/Edge.ts's `memoryResumedFor`).

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

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout matches "\"session\":\{\"id\":\"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\""
    And stdout contains "\"resume\":false"
    And I record the json field "session.id" as "s1"

    Given a file "NOTE.md" with:
      """
      the agent did some work
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And the json field "session.id" matches the one recorded as "s1"
    And stdout contains "\"resume\":true"

  Scenario: two peeks with no step in between derive the SAME id, both resume:false
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd land
    Then it succeeds

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"resume\":false"
    And I record the json field "session.id" as "first peek"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"resume\":false"
    And the json field "session.id" matches the one recorded as "first peek"

  Scenario: a message rest and a script rest emit no session at all
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout does not contain "\"session\""

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

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"checking.verify\""
    And stdout does not contain "\"session\""

  Scenario: a nested child machine prompt gets a DIFFERENT id from the parent; on return the parent's id is unchanged with resume:true
    Given a file "NOTE.md" with:
      """
      start
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"resume\":false"
    And I record the json field "session.id" as "the outer session"

    Given a file "CHECKFILE.md" with:
      """
      ready
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → checking.verify"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"checking.verify\""
    And stdout does not contain "\"session\""

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking.verify → checking.ask"

    # REVIEW.md is written BEFORE this peek, not after: the "verify" script's
    # own clean-tree "C" transition just landed an EMPTY commit at checking.ask
    # (a prompt rest) — a bare peek there would otherwise itself derive
    # kind: "stalled" (Beat.ts's beatKindOf), which drops the session field by
    # construction. A dirty tree suppresses that (stalledAt's own first
    # clause), so writing the reviewer's file first is what makes this peek a
    # kind: "prompt" beat worth inspecting.
    Given a file "REVIEW.md" with:
      """
      looks good
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"checking.ask\""
    And stdout contains "\"resume\":false"
    And the json field "session.id" differs from the one recorded as "the outer session"
    And I record the json field "session.id" as "the child session"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(reviewer): checking.ask → working"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And the json field "session.id" matches the one recorded as "the outer session"
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

    # See the same-named comment above: REVIEW.md must exist before this peek,
    # or the just-landed empty "C" transition reads as a stalled beat instead.
    Given a file "REVIEW.md" with:
      """
      looks good
      """
    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "session.id" as "the first child session"

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

    # See the same-named comment above: REVIEW.md must exist before this peek.
    Given a file "REVIEW.md" with:
      """
      looks good again
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"checking.ask\""
    And the json field "session.id" differs from the one recorded as "the first child session"
