@inmem
Feature: Structural validation of the agent's grilling/architecting/review draft

  `.gtd/TODO.md` / `.gtd/ARCHITECTURE.md` (an optional `## Open Questions`
  section, `###` sub-headings each carrying a `Suggested default:`/`Answer:`
  line) and `.gtd/REVIEW.md` (a `# Review: <hash>` header, a
  `<!-- base: ... -->` comment, and `##` chunks each with at least one file
  pointer) follow an enforced structure. A malformed file blocks the AGENT's
  own turn capture — `gtd step-agent` refuses with zero commits and a
  diagnostic on stderr — but never blocks a HUMAN's own turn at the same gate,
  since file content otherwise never steers the machine.

  Scenario: A malformed open question refuses the agent's grilling turn
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Open Questions

      ### Which operations?

      Not sure yet.
      """
    And I record the commit count
    When I run gtd step-agent
    Then it fails
    And the commit count is unchanged
    And stderr contains ".gtd/TODO.md does not match the required structure"
    And stderr contains "Which operations?"

  Scenario: Fixing the malformed question lets the agent's grilling turn land
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Open Questions

      ### Which operations?

      Suggested default: add and subtract.
      """
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling"

  Scenario: A human's non-conforming edit at the grilling answer gate is never refused
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Open Questions

      ### Which operations?

      Suggested default: add and subtract.
      """
    And I run gtd step-agent
    And ".gtd/TODO.md" is modified to:
      """
      # Plan

      Build a calculator. Just do addition, subtraction, and multiplication —
      no need for a formal question/answer section.
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"

  Scenario: A malformed open question refuses the agent's architecting turn
    Given a test project
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Refactor the calculator module to use a strategy pattern.
      """
    And I run gtd step
    And ".gtd/ARCHITECTURE.md" is modified to:
      """
      # Architecture

      Refactor the calculator module to use a strategy pattern.

      ## Open Questions

      ### Which design pattern?

      Strategy pattern seems reasonable but not confirmed.
      """
    And I record the commit count
    When I run gtd step-agent
    Then it fails
    And the commit count is unchanged
    And stderr contains ".gtd/ARCHITECTURE.md does not match the required structure"
    And stderr contains "Which design pattern?"

  Scenario: A malformed REVIEW.md refuses the agent's review turn
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: close-package"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1
      """
    And I record the commit count
    When I run gtd step-agent
    Then it fails
    And the commit count is unchanged
    And stderr contains ".gtd/REVIEW.md does not match the required structure"
    And stderr contains "base"

  Scenario: A well-formed REVIEW.md lets the agent's review turn land
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: close-package"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234000000000000000000000000000000 -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      """
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"

  Scenario: A human's substantive REVIEW.md edit is never refused, even if it breaks the structure
    Given a test project
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: close-package"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234000000000000000000000000000000 -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      """
    And I run gtd step-agent
    And ".gtd/REVIEW.md" is modified to:
      """
      Please also add a subtract function.
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd: grilling"
