@inmem
Feature: Project-owned root-level files named like steering files are ordinary code

  All workflow state lives under `.gtd/`. A TODO.md, REVIEW.md, FEEDBACK.md,
  or SQUASH_MSG.md at the repository root belongs to the project, not to the
  workflow: it never resumes grilling, never hard-errors as an illegal
  steering-file combination, and is never consumed or deleted by a routing
  commit.

  Scenario: A committed root-level TODO.md does not resume grilling
    Given a test project
    And a commit "docs: project todo list" that adds "TODO.md" with:
      """
      # Project backlog

      - [ ] things humans track by hand
      """
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: Root-level FEEDBACK.md and REVIEW.md together are legal project files
    Given a test project
    And a file "FEEDBACK.md" with:
      """
      Customer feedback collected by the project itself.
      """
    And a file "REVIEW.md" with:
      """
      # Architecture review notes owned by the project
      """
    And the working tree is committed as "docs: project-owned docs"
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"
