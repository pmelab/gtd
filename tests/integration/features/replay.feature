@inmem
Feature: Replay — every committed rest resolves deterministically

  All machine state lives in commits: `gtd next` and `gtd status` are pure and
  read only the working tree + first-parent history, so re-running either at
  the same commit yields the same fragment with zero side effects. Re-running
  `gtd step human` / `gtd step agent` at a fixpoint (the rest the machine already
  settled at) is idempotent — it authors zero new commits. A history built
  without ever touching the working tree in between (as a clone or checkout
  would present it) resolves to the same `gtd next` output as the live process
  that produced it, because no state is carried outside of commits.

  Scenario: gtd next is pure at a clean building rest — repeated calls and status agree
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    Then I record the commit count
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And the commit count is unchanged
    When I run gtd status
    Then it succeeds
    And stdout contains "Awaits: agent"
    And the commit count is unchanged

  Scenario: gtd next is pure at the human review gate — repeated calls and status agree
    Given a test project
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    Then I record the commit count
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    And the commit count is unchanged
    When I run gtd status
    Then it succeeds
    And stdout contains "Awaits: human"
    And the commit count is unchanged

  Scenario: gtd next is pure at the escalate gate — repeated calls and status agree
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: escalated" that adds ".gtd/ERRORS.md" with:
      """
      persistent failure output
      """
    Then I record the commit count
    When I run gtd next
    Then it succeeds
    And stdout contains "was not able to fix all errors on its own"
    When I run gtd next
    Then it succeeds
    And stdout contains "was not able to fix all errors on its own"
    And the commit count is unchanged
    When I run gtd status
    Then it succeeds
    And stdout contains "Awaits: human"
    And the file ".gtd/ERRORS.md" exists
    And the commit count is unchanged

  Scenario: A second gtd step agent once the agent-side pipeline settles at idle is a no-op
    # A single gtd step agent invocation advances the agent's side of the
    # pipeline all the way to fixpoint for the LAST package: an approving
    # empty FEEDBACK.md turn closes the package and, with no packages
    # remaining and no reviewable diff yet authored, settles at idle. A second
    # step-agent there is refused (idle awaits a human turn) and authors
    # nothing.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: tests-green"
    And an empty file ".gtd/FEEDBACK.md"
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: close-package"
    And the file ".gtd" does not exist
    Then I record the commit count
    When I run gtd step agent
    Then it fails
    And stderr contains "awaits a human turn"
    And the commit count is unchanged

  Scenario: A second gtd step human at the human review rest is a no-op once approved
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: await-review"
    And I run gtd step human
    Then I record the commit count
    When I run gtd step human
    Then it succeeds
    And the commit count is unchanged
    And the last commit subject is "gtd: done"

  Scenario: An idle feature branch resolves the same next output on repeated calls
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "feat: branch work" that adds "src/feat.ts" with:
      """
      export const feat = 1
      """
    Then I record the commit count
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    And the commit count is unchanged

  Scenario: A history built with no intervening working-tree state resolves the same next output as a live run would
    # No `runGtd` call happens between these Given steps — the commits alone
    # carry every bit of state the machine needs, exactly as a fresh clone or
    # `git checkout` of this exact history would present it.
    Given a test project
    And a commit "gtd: grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan
      - [ ] add helper
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: tests-green"
    Then I record the commit count
    When I run gtd next
    Then it succeeds
    And stdout contains "Spawn a **reviewing subagent**"
    And the commit count is unchanged
    When I run gtd next
    Then it succeeds
    And stdout contains "Spawn a **reviewing subagent**"
    And the commit count is unchanged
