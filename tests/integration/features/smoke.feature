@inmem
Feature: v3 pattern-machine smoke — one-flow hops, gtd next --json, custom squash

  Minimal smoke coverage for the v3 CLI (`gtd land` / `gtd next` /
  `gtd status`, see src/Edge.ts and
  docs/design/pattern-machine-plan.md). Proves the rewritten edge/CLI wiring
  end to end: a handful of hops on the built-in default workflow's one flow,
  the `gtd next --json` contract, and a custom `.gtdrc` `workflow:` squashing
  through a `commit:` state. Comprehensive coverage (every state, retry/
  escalation, the full check/fix/review tail, both refusal shapes) has its own
  dedicated feature files — see refusals.feature, default-workflow.feature,
  retry.feature, squash.feature.

  Scenario: the one flow's happy path advances idle -> unwind -> start-gate.check -> design.triage -> design.gate.check -> architecture.author -> architecture.gate.check -> architecture.decompose -> packages.picking -> packages.item.building -> packages.item.health.check
    Given a test project
    And the workflow
    And a file "src/feature.ts" with:
      """
      export const feature = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"
    # unwind: simulate the `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "src/feature.ts" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"
    # The green-baseline gate: a clean tree (tests pass) advances to design.triage.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"
    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Add a feature. No open questions.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.check"
    # No open questions recorded -> the human gate is skipped entirely.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → architecture.author"
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the feature. No open questions.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.author → architecture.gate.check"
    # No open questions recorded -> the human gate is skipped entirely.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): architecture.gate.check → architecture.decompose"
    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-feature.md" with:
      """
      Package: add the feature.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.decompose → packages.picking"
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-feature.md
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → packages.item.building"
    Given a file "src/feature-impl.ts" with:
      """
      export const featureImpl = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

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
