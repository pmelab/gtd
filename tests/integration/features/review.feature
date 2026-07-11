@inmem
Feature: Human review gate — approve, checkbox-approve, or feed back

  The gate fixture is built from two commits: `gtd(agent): review` (adds
  REVIEW.md) followed by the routing `gtd: awaiting review` that commits it.
  `gtd next` at that gate emits a human-actor prompt. A clean `gtd step`
  approves: an empty `gtd(human): review` turn plus routing `gtd: done`, and
  REVIEW.md is gone from the tree. Flipping only `- [ ]` to `- [x]` in
  REVIEW.md is also treated as a clean approval (the machine-computed checkbox
  carve-out). Any substantive edit — to REVIEW.md or to the code — is
  feedback: `gtd(human): review` plus routing `gtd: review feedback`, REVIEW.md
  removed, and `gtd next` re-emits a grilling prompt to the agent whose text
  inlines the human's finding. After approval, invoking again is a no-op.

  Scenario: The human review gate emits an actor-human prompt
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd: awaiting review"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    And stdout contains ".gtd/REVIEW.md"

  Scenario: A clean step approves the review as gtd: done
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd: awaiting review"
    When I run gtd step
    Then it succeeds
    And the git log contains "gtd(human): review"
    And the last commit subject is "gtd: done"
    And the file ".gtd/REVIEW.md" does not exist

  Scenario: Checking off REVIEW.md checkboxes only still approves the review
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      - [ ] ./src/calc.ts#1 — export statement
      """
    And a commit "gtd: awaiting review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review

      ## Add calculator

      - [x] ./src/calc.ts#1 — new add function
      - [x] ./src/calc.ts#1 — export statement
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd: done"
    And the file ".gtd/REVIEW.md" does not exist

  Scenario: A substantive REVIEW.md edit is feedback and re-grills the agent with the finding
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd: awaiting review"
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function

      Please also add a subtract function.
      """
    When I run gtd step
    Then it succeeds
    And the git log contains "gtd(human): review"
    And the last commit subject is "gtd: review feedback"
    And the file ".gtd/REVIEW.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "Please also add a subtract function."

  Scenario: Editing the code under a committed REVIEW.md is also feedback
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd: awaiting review"
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // reviewer: please also add subtract
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd: review feedback"
    And the file ".gtd/REVIEW.md" does not exist
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "reviewer: please also add subtract"

  Scenario: After approval, invoking again adds zero commits
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): review" that adds ".gtd/REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      """
    And a commit "gtd: awaiting review"
    And I run gtd step
    And I record the commit count
    When I run gtd step
    Then it succeeds
    And the commit count is unchanged

  Scenario: A historical review turn without a review record rests instead of routing to the human gate
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd(agent): building" that adds "src/helper.ts" with:
      """
      export const helper = () => 42
      """
    And a commit "gtd: package done"
    And a commit "gtd(agent): review"
    Then I record the commit count
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
    And the git log does not contain "gtd: awaiting review"
    When I run gtd next
    Then it succeeds
    And stdout contains "help a human to review the changes"
