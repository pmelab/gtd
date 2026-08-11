@inmem
Feature: v3 pattern-machine smoke — simple workflow hops, gtd next --json, custom squash

  Minimal smoke coverage for the v3 CLI (`gtd land` / `gtd next` /
  `gtd status`, see src/Edge.ts and
  docs/design/pattern-machine-plan.md). Proves the rewritten edge/CLI wiring
  end to end: a couple of simple-flow hops on the built-in default workflow, the
  `gtd next --json` contract, and a custom `.gtdrc` `workflow:`
  squashing through a `commit:` state. Comprehensive coverage (every
  simple-workflow state, retry/escalation, the full check/fix/review tail,
  both refusal shapes) has its own dedicated feature files — see
  refusals.feature, default-workflow.feature, retry.feature, squash.feature.

  Scenario: the simple workflow's happy path advances idle -> plan-gate.check -> plan.planning -> plan.await-plan -> build.building -> build.health.check
    Given a test project
    And the workflow
    And a file ".gtd/TODO.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-gate.check"
    # The green-baseline gate: a clean tree (tests pass) advances to plan.planning.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): plan-gate.check → plan.planning"
    Given ".gtd/TODO.md" is modified to:
      """
      Build a thing. Developed into a concrete plan.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): plan.planning → plan.await-plan"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): plan.await-plan → build.building"
    Given a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.building → build.health.check"

  Scenario: gtd next --json reports state, actor, kind, and content
    Given a test project
    And the workflow
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout contains "\"actor\":\"human\""
    And stdout contains "\"kind\":\"message\""
    And stdout contains "No active gtd process."

  Scenario: a custom workflow squashes the whole process into one commit via a commit: state
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
    And I record the commit count
    And a file "NOTE.md" with:
      """
      Remember the milk.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"
    Given a file "COMMIT_MSG.md" with:
      """
      feat: remember the milk
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "feat: remember the milk"
    And "NOTE.md" exists
    And "COMMIT_MSG.md" does not exist
    # squashed onto the pre-process commit + the one squash commit — the
    # intermediate "gtd(human): working" turn is gone, collapsed away.
    And the commit count increased by 1
