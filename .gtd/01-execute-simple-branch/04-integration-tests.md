# Add integration tests for execute-simple branch

## Description

Add Cucumber scenarios to verify that the `<!-- simple -->` marker correctly routes to `execute-simple` branch, and that TODO.md without the marker still routes to `decompose`.

## Files to modify

- `tests/integration/features/branches.feature`

## Implementation

Add these scenarios after the existing "Clean tree after a TODO.md-only commit triggers decompose" scenario:

```gherkin
  Scenario: TODO.md with simple marker triggers execute-simple
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Add a greeting to the CLI output

      <!-- simple -->
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Execute simple task"
    And stdout does not contain "## Task: Decompose"

  Scenario: TODO.md without simple marker triggers decompose
    Given a test project
    And a commit "docs: seed plan" that adds "TODO.md" with:
      """
      Refactor authentication to use JWT
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Decompose"
    And stdout does not contain "## Task: Execute simple task"
```

Note: The second scenario may overlap with an existing test. If "Clean tree after a TODO.md-only commit triggers decompose" already covers this, consider whether to keep both or just add the first scenario.

## Acceptance criteria

- [ ] Scenario for TODO.md with `<!-- simple -->` marker exists
- [ ] Scenario verifies "## Task: Execute simple task" appears in output
- [ ] Scenario verifies "## Task: Decompose" does NOT appear
- [ ] Tests pass when run with `npm test`
