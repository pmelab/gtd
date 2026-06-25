Feature: Auto-advance and STOP markers in prompts

  Scenario: New TODO triggers auto-advance instruction
    Given a test project
    And a file "TODO.md" with:
      """
      - build a math library
      """
    When I run gtd
    Then it succeeds
    And stdout contains "Re-run gtd immediately"
    And stdout contains "Do not wait for user"

  Scenario: Decompose prompt includes auto-advance
    Given a test project
    And a commit "plan(gtd): ready complete" that adds "TODO.md" with:
      """
      ## Plan

      - build a math library

      ## Resolved

      ### Is this enough?

      **Decision:** Yes.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout contains "Re-run gtd immediately"

  Scenario: Code changes are committed by the edge, then the loop advances to the next leaf
    # `code-changes` is edge-driven: one gtd run commits the dirty file and drives
    # the loop forward. The retired prompt no longer appears; instead the commit
    # lands and the next leaf's prompt (verified, here — clean tree, no review base)
    # is the only stdout.
    Given a test project
    And a file "hello.txt" with:
      """
      hello world
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "chore(gtd): commit pending changes"
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout does not contain "## Task: Commit the uncommitted changes"

  Scenario: Verified prompt contains STOP and no auto-advance
    Given a test project
    And a commit "feat: init" that adds "index.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Confirm the working tree is healthy and fully reviewed"
    And stdout contains "STOP"
    And stdout does not contain "Re-run gtd immediately"

  Scenario: Human-review prompt auto-advances and contains no STOP
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: add feature" that adds "src/feature.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "chore: add package.json" that adds "package.json" with:
      """
      { "scripts": { "test": "exit 0" } }
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Generate REVIEW.md"
    And stdout contains "the next cycle commits"
    And stdout does not contain "STOP"
