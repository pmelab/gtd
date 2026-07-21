@inmem
Feature: Build lifecycle — the .gtd/ package lifecycle from planning to building

  Once `gtd: building` rests, `gtd next` selects the lowest-numbered package
  under `.gtd/` and inlines only that package's task content into the building
  prompt for the agent. When a package closes (`gtd: close-package`) with a
  second package still remaining, the loop immediately offers that next
  package rather than settling — `gtd next` emits the building prompt for it.
  Junk inside `.gtd/` (non-numbered directories, non-task files) is ignored.

  Scenario: A rest at gtd: building emits the building prompt listing the first package's task
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And stdout contains "01-add"
    And stdout contains "Implement the add function."

  Scenario: With two packages, the building prompt inlines only the lowest-numbered one
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    And a commit "gtd: building" that adds ".gtd/02-sub/01-sub.md" with:
      """
      Implement the subtract function.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And stdout contains "01-add"
    And stdout contains "Implement the add function."
    And stdout does not contain "Implement the subtract function."

  Scenario: After gtd: close-package with a second package remaining, gtd next emits the building prompt for it
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    And a commit "gtd: building" that adds ".gtd/02-sub/01-sub.md" with:
      """
      Implement the subtract function.
      """
    And a commit "gtd: close-package" that deletes ".gtd/01-add/01-add.md"
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And stdout contains "02-sub"
    And stdout contains "Implement the subtract function."
    And stdout does not contain "Implement the add function."

  Scenario: gtd step agent at the second package's building rest lands its own package-done
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      """
    And a commit "gtd: building" that adds ".gtd/01-add/01-add.md" with:
      """
      Implement the add function.
      """
    And a commit "gtd: building" that adds ".gtd/02-sub/01-sub.md" with:
      """
      Implement the subtract function.
      """
    And a commit "gtd: close-package" that deletes ".gtd/01-add/01-add.md"
    And a file "src/sub.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): building"
    # agenticReview is off: the green check force-approves and closes inline.
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd: close-package"
    And the file ".gtd" does not exist

  Scenario: Non-numbered junk inside .gtd is ignored by the building prompt
    Given a test project
    And a commit "gtd: building" that adds ".gtd/notes.txt" with:
      """
      scratch notes, not a package
      """
    And a commit "gtd: building" that adds ".gtd/01-real/01-task.md" with:
      """
      Implement the real package.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And stdout contains "Implement the real package."
    And stdout does not contain "notes.txt"

  Scenario: Non-task files inside a numbered package directory are ignored
    Given a test project
    And a commit "gtd: building" that adds ".gtd/01-real/README.notes" with:
      """
      internal scratch, not a task file
      """
    And a commit "gtd: building" that adds ".gtd/01-real/01-task.md" with:
      """
      Implement the real package.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Implement the real package."
    And stdout does not contain "internal scratch, not a task file"
