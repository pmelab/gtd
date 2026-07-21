@inmem
Feature: Close package — one gtd: close-package per package, via the CLI

  A clean `gtd: tests-green` rest with agentic review force-approved (or an
  approving empty FEEDBACK.md turn) closes the active package: FEEDBACK.md and
  the finished package directory are removed and the result committed
  `gtd: close-package` in the same turn. If packages remain, the loop advances
  straight to the next package's building prompt; if it was the last, the
  now-empty `.gtd/` is removed too and the loop advances to the human review
  record.

  # `gtd: close-package` is itself a rest (per the design contract: "building
  # prompt if packages remain"), so closing package 01 stops the chain right
  # there even though the second package is fully automatable — a fresh
  # `gtd step agent` invocation is required to drive package 02's own
  # building/testing/agentic-review to its own gtd: close-package.
  Scenario: An empty-FEEDBACK.md review turn closes the first package, then a fresh step-agent closes the fully-automatable second package too
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the first helper.
      """
    And a commit "gtd: building" that adds ".gtd/02-bar/01-task.md" with:
      """
      Implement the second helper.
      """
    And a commit "gtd: tests-green"
    And an empty file ".gtd/FEEDBACK.md"
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): agentic-review"
    And the file ".gtd/01-foo/01-task.md" does not exist
    And the file ".gtd/02-bar/01-task.md" exists
    And the last commit subject is "gtd: close-package"
    And a file "src/second-helper.ts" with:
      """
      export const secondHelper = () => 43
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): building"
    And the last commit subject is "gtd: tests-green"
    And an empty file ".gtd/FEEDBACK.md"
    When I run gtd step agent
    Then it succeeds
    And the file ".gtd/02-bar/01-task.md" does not exist
    And the file ".gtd" does not exist
    And the last commit subject is "gtd: close-package"

  Scenario: Closing the last package removes .gtd and advances to the human review record
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan
      - [ ] implement the only helper
      """
    And a commit "gtd: grilled" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the only helper.
      """
    And a commit "gtd(agent): building" that adds "src/helper.ts" with:
      """
      export const helper = () => 42
      """
    And a commit "gtd: tests-green"
    And an empty file ".gtd/FEEDBACK.md"
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd: close-package"
    And the file ".gtd" does not exist
    And the file ".gtd/FEEDBACK.md" does not exist
    And the last commit subject is "gtd: close-package"
    # `gtd: close-package` with no packages remaining is itself a rest (the
    # review-record prompt) — a FRESH agent turn is required to author the
    # review capture. Since no agent wrote REVIEW.md, a bare step-agent here
    # is a do-nothing invocation: inert, zero commits — the machine must NOT
    # route to `gtd: await-review` without a review record for the human.
    Then I record the commit count
    When I run gtd step agent
    Then it succeeds
    And the commit count is unchanged
    And the git log does not contain "gtd: await-review"
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/REVIEW.md"
    And stdout contains "help a human to review the changes"

  Scenario: Force-approve via agenticReview false also closes the package without ever writing FEEDBACK.md
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      agenticReview: false
      """
    And a commit "gtd: building" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: tests-green"
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: close-package"
    And the file ".gtd/01-foo/01-task.md" does not exist
    And the file ".gtd/FEEDBACK.md" does not exist
    And the git log does not contain "gtd(agent): agentic-review"
