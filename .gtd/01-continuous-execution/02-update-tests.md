# Task: Update integration tests for continuous execution

## File to modify

`tests/integration/features/branches.feature`

## Current scenario to update

The existing "Existing .gtd with packages" scenario asserts the old title:

```gherkin
Scenario: Existing .gtd with packages triggers execute
  Given a test project
  And a commit "plan(gtd): decompose" that adds ".gtd/01-math/01-add.md" with:
    """
    Implement the add function
    """
  And a commit "plan(gtd): decompose" that adds ".gtd/01-math/COMMIT_MSG.md" with:
    """
    feat(math): implement addition
    """
  When I run gtd
  Then it succeeds
  And stdout contains "## Task: Execute the next work package"
  And stdout contains "01-math"
  And stdout contains "01-add.md"
```

## Change 1 — Update existing scenario title assertion

Change:
```gherkin
  And stdout contains "## Task: Execute the next work package"
```

To:
```gherkin
  And stdout contains "## Task: Execute all work packages"
```

## Change 2 — Add new scenario for multi-package listing

Add this new scenario after the existing execute scenario:

```gherkin
  Scenario: Execute prompt lists all packages when multiple exist
    Given a test project
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/01-task.md" with:
      """
      First task
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/01-foo/COMMIT_MSG.md" with:
      """
      feat: first
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/02-bar/01-task.md" with:
      """
      Second task
      """
    And a commit "plan(gtd): decompose" that adds ".gtd/02-bar/COMMIT_MSG.md" with:
      """
      feat: second
      """
    When I run gtd
    Then it succeeds
    And stdout contains "01-foo"
    And stdout contains "02-bar"
```

## Acceptance criteria

- [ ] Existing execute scenario assertion updated from "next work package" to "all work packages"
- [ ] New scenario added that sets up two packages (01-foo, 02-bar)
- [ ] New scenario asserts both package names appear in stdout
- [ ] All existing scenarios continue to pass
