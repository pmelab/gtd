@inmem
Feature: v3 pattern-machine smoke — default workflow, refusals, gtd next --json, custom squash

  Minimal smoke coverage for the v3 CLI (`gtd step <actor>` / `gtd next` /
  `gtd run` / `gtd status`, see src/Edge.ts and
  docs/design/pattern-machine-plan.md). Proves the rewritten edge/CLI wiring
  end to end: a couple of default-workflow hops, both refusal shapes, the
  `gtd next --json` contract, and a custom `.gtdrc` `workflow:` squashing
  through a `commit:` state. Comprehensive coverage (every default-workflow
  state, retry/escalation, the full check/fix/review cycle) is Phase 4's job.

  Scenario: the default workflow's happy path advances idle -> grilling -> grilling-answer -> architecting
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Developed into a concrete plan.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling-answer"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): architecting"

  Scenario: out-of-turn refusal names the awaited actor
    Given a test project
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd step human
    Then it succeeds
    When I run gtd step human
    Then it fails
    And stderr contains "out of turn"
    And stderr contains "awaits agent"

  Scenario: gtd next --json reports state, actor, kind, and content
    Given a test project
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout contains "\"actor\":\"human\""
    And stdout contains "\"kind\":\"message\""
    And stdout contains "No active gtd cycle."

  Scenario: no-match refusal names the state's declared patterns
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
    Given a file "scratch.txt" with:
      """
      unrelated pending change
      """
    When I run gtd step agent
    Then it fails
    And stderr contains "no declared pattern matches"
    And stderr contains "A COMMIT_MSG.md"
    And stderr contains "M COMMIT_MSG.md"

  Scenario: a custom workflow squashes the whole cycle into one commit via a commit: state
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
    And I record the commit count
    And a file "NOTE.md" with:
      """
      Remember the milk.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): working"
    Given a file "COMMIT_MSG.md" with:
      """
      feat: remember the milk
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "feat: remember the milk"
    And "NOTE.md" exists
    And "COMMIT_MSG.md" does not exist
    # squashed onto the pre-cycle commit + the one squash commit — the
    # intermediate "gtd(human): working" turn is gone, collapsed away.
    And the commit count increased by 1
