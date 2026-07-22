@inmem
Feature: v3 pattern-machine smoke — default workflow hops, gtd next --json, custom squash

  Minimal smoke coverage for the v3 CLI (`gtd step <actor>` / `gtd next` /
  `gtd run` / `gtd status`, see src/Edge.ts and
  docs/design/pattern-machine-plan.md). Proves the rewritten edge/CLI wiring
  end to end: a couple of default-workflow hops, the `gtd next --json`
  contract, and a custom `.gtdrc` `workflow:` squashing through a `commit:`
  state. Comprehensive coverage (every default-workflow state,
  retry/escalation, the full check/fix/review cycle, both refusal shapes) has
  its own dedicated feature files — see refusals.feature,
  default-workflow.feature, retry.feature, squash.feature.

  Scenario: the default workflow's happy path advances idle -> grilling -> todo-validating -> grilling-answer -> building -> checking
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
    And the last commit subject is "gtd(agent): todo-validating"
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): grilling-answer"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): building"
    Given a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): checking"

  Scenario: gtd next --json reports state, actor, kind, and content
    Given a test project
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout contains "\"actor\":\"human\""
    And stdout contains "\"kind\":\"message\""
    And stdout contains "No active gtd cycle."

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
