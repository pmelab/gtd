# Update cucumber scenarios for squashing

File: `tests/integration/features/squashing.feature`

## Overview of changes

1. Update existing "Happy path" scenario: the prompt no longer instructs the
   agent to run `git reset --soft` — instead it asks the agent to write
   SQUASH_MSG.md. Remove the `stdout contains "git reset --soft"` assertion and
   replace with the new instruction assertions.

2. Update "Interleaved non-gtd commit" scenario similarly.

3. Add two new scenarios:
   - Agent writes SQUASH_MSG.md → gtd performs the squash commit
   - SQUASH_MSG.md excluded from code diff (does not cause dirty-tree loop)

## Scenario 1 update: Happy path

Replace the current assertions in the "Happy path" scenario:

Old assertions:

```gherkin
    And stdout contains "git reset --soft"
    And stdout contains "src/calc.ts"
    And stdout contains "Re-run gtd immediately after completing the steps above."
    And stdout does not contain "STOP — do not re-run"
```

New assertions:

```gherkin
    And stdout contains "Write the commit message"
    And stdout contains "SQUASH_MSG.md"
    And stdout contains "src/calc.ts"
    And stdout contains "STOP — do not re-run"
    And stdout does not contain "git reset --soft"
    And stdout does not contain "git commit"
```

Rationale: squashing is now `autoAdvance: false` (prompt state), so the stop
partial fires. The new prompt instructs the agent to write SQUASH_MSG.md; no git
commands appear in the prompt.

## Scenario 2 update: Interleaved non-gtd commit

Same assertion updates as above — remove `stdout contains "git reset --soft"`,
add `stdout contains "SQUASH_MSG.md"` instead.

## Scenario 3 (new): Agent writes SQUASH_MSG.md — gtd performs the squash commit

Add after the "Interleaved non-gtd commit" scenario and before "Squash
disabled":

```gherkin
  @squashing
  Scenario: SQUASH_MSG.md present — gtd performs the squash commit on next run
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add calculator
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: package done"
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: done" that deletes "REVIEW.md"
    And a file "SQUASH_MSG.md" with content:
      """
      feat(calc): add calculator

      Decided during grilling to use simple addition only.
      """
    When I run gtd
    Then it succeeds
    And the HEAD commit subject is "feat(calc): add calculator"
    And "SQUASH_MSG.md" does not exist
    And "src/calc.ts" exists
```

## Scenario 4 (new): SQUASH_MSG.md does not trigger dirty-tree loop

Add after scenario 3:

```gherkin
  @squashing
  Scenario: SQUASH_MSG.md present alone does not cause codeDirty
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add calculator
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: package done"
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review
      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: done" that deletes "REVIEW.md"
    And a file "SQUASH_MSG.md" with content:
      """
      feat(calc): add calculator
      """
    When I run gtd
    Then it succeeds
    And the HEAD commit subject is "feat(calc): add calculator"
```

## Step definitions to add/check

Check `tests/integration/support/` for existing step definitions. The following
steps may need to be added if not already present:

- `And a file {string} with content:` — writes a plain file with the given
  content to the test repo root.
- `And the HEAD commit subject is {string}` — asserts `git log -1 --format=%s`
  equals the given string.
- `And {string} does not exist` — asserts the path does not exist in the repo.
- `And {string} exists` — asserts the path exists.

Check `tests/integration/support/steps.ts` (or equivalent) for the step
definitions file and add only the missing ones.
