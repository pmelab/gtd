@inmem
Feature: Grilling — the 3-way convergence gate on TODO.md

  TODO.md present (and not New Feature) is Grilling. It resolves three ways by
  the `<!-- user answers here -->` convergence marker and tree state: an open
  marker stops for the human, no marker + pending edits lets the agent iterate,
  and no marker + a clean tree converges to Grilled (`gtd: grilled`). Every round
  commits its pending tree as `gtd: grilling` first.

  Scenario: An open marker stops for the user to answer inline
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      <!-- user answers here -->
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And stdout contains "holds the plan under development"
    And stdout contains "Open questions await the user"
    And stdout does not contain "Decompose it into an ordered set of"

  Scenario: No marker but pending edits lets the grilling agent iterate
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And "TODO.md" is modified to:
      """
      # Plan

      Build a calculator with add and subtract.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And stdout contains "holds the plan under development"
    And stdout contains "### Develop the plan"

  Scenario: No marker and a clean tree converges to Grilled and STOPs for human review
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator with add and subtract.

      no open questions — run gtd to plan
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And stdout contains "Human review gate"
    And stdout does not contain "Decompose it into an ordered set of"

  Scenario: Re-running after review with a clean tree proceeds to decomposition
    Given a test project
    And a commit "gtd: grilled" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator with add and subtract.

      no open questions — run gtd to plan
      """
    When I run gtd
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"
    And stdout does not contain "Human review gate"
    Then I record the commit count
    And the commit count is unchanged

  Scenario: Re-running after review with edits to TODO.md re-enters grilling
    Given a test project
    And a commit "gtd: grilled" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator with add and subtract.

      no open questions — run gtd to plan
      """
    And "TODO.md" is modified to:
      """
      # Plan

      Build a calculator with add, subtract, multiply, and divide.

      no open questions — run gtd to plan
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And stdout contains "### Develop the plan"
    And stdout does not contain "Human review gate"

  Scenario: Marker inside an unclosed code fence does not stop for the user
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      ```
      <!-- user answers here -->
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And stdout does not contain "Open questions await the user"

  Scenario: Marker inside a closed code fence is ignored
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      ```
      <!-- user answers here -->
      ```
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And stdout does not contain "Open questions await the user"

  Scenario: Re-running at a grilling STOP is idempotent — no extra commit
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      <!-- user answers here -->
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And stdout contains "Open questions await the user"
    Then I record the commit count
    When I run gtd
    Then it succeeds
    And the commit count is unchanged
    And the last commit subject is "gtd: grilling"
    And stdout contains "Open questions await the user"

  # Later grilling rounds (committed plan) treat user code sketches as
  # suggestions: the diff is folded into TODO.md and the code is reverted, so
  # nothing lands on the branch without going through plan → build → test →
  # review. The seed round (uncommitted TODO.md) still commits the seed revert
  # verbatim.
  Scenario: Code sketched during grilling is captured into the plan and reverted
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a file "src/sketch.ts" with:
      """
      export const sketch = () => 1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And the file "src/sketch.ts" does not exist
    And the file "TODO.md" contains "Captured input (grilling)"
    And the file "TODO.md" contains "export const sketch"
    And the file "TODO.md" contains "Interpret the captured diff"
    And stdout contains "holds the plan under development"

  Scenario: Code sketched while questions are open is captured and gtd still stops
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      ## Which operations?

      <!-- user answers here -->
      """
    And a file "src/sketch.ts" with:
      """
      export const sketch = () => 1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And the file "src/sketch.ts" does not exist
    And the file "TODO.md" contains "export const sketch"
    And stdout contains "Open questions await the user"

  # A committed TODO.md under a boundary HEAD is a resumed grill — even with a
  # dirty tree it must not re-seed (New Feature would clobber the developed
  # plan); the code edits are captured instead.
  Scenario: A resumed grill with code edits does not re-seed over the committed plan
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      A carefully developed plan.
      """
    And a commit "chore: unrelated housekeeping"
    And a file "src/sketch.ts" with:
      """
      export const sketch = () => 1
      """
    When I run gtd
    Then it succeeds
    And the git log does not contain "gtd: new task"
    And the last commit subject is "gtd: grilling"
    And the file "TODO.md" contains "A carefully developed plan."
    And the file "TODO.md" contains "export const sketch"
    And the file "src/sketch.ts" does not exist

  Scenario: A .gtd package file whose name contains a space is classified as gtd, not code
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-feature/my task.md" with:
      """
      - [ ] implement the thing
      """
    And ".gtd/01-feature/my task.md" is modified to:
      """
      - [x] implement the thing
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: planning"
    And stdout does not contain "## Task: Run tests"
