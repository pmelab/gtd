Feature: Working-tree-shape intent inference drives commit subjects

  After an agent run, gtd infers the intent from the working tree and commits
  with the appropriate subject — no sentinel file required.

  Scenario: Fresh untracked REVIEW.md → review commit with base short-sha
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: something" that adds "src/x.ts" with:
      """
      export const x = 1
      """
    And an untracked file "REVIEW.md" with:
      """
      # Review

      <!-- base: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef -->

      - [ ] item one
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "review(gtd): create review for deadbee"

  Scenario: TODO.md deleted + package dirs present → decompose commit
    Given a test project
    And a commit "plan(gtd): ready complete" that adds "TODO.md" with:
      """
      # Plan
      - step one
      """
    And a deleted committed file "TODO.md"
    And a package dir ".gtd/01-foo" with COMMIT_MSG.md "feat: foo"
    And a package dir ".gtd/02-bar" with COMMIT_MSG.md "feat: bar"
    When I run gtd
    Then it succeeds
    And the last commit subject is "plan(gtd): decompose TODO.md into 2 work packages"

  Scenario: Dirty source + package with COMMIT_MSG.md → verbatim COMMIT_MSG subject
    Given a test project
    And a commit "plan(gtd): decompose" that adds ".gtd/01-work/01-task.md" with:
      """
      Implement the feature
      """
    And a package dir ".gtd/01-work" with COMMIT_MSG.md "feat(core): implement the feature"
    And a file "src/impl.ts" with:
      """
      export const impl = true
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "feat(core): implement the feature"

  Scenario: Dirty source in active verify loop → fix-tests commit with trailer
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: base" that adds "src/base.ts" with:
      """
      export const base = 1
      """
    And a fix(gtd) commit "fix(gtd): attempt 1"
    And a file "src/fix.ts" with:
      """
      export const fix = true
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "fix(gtd): apply test fix"
    And the last commit body contains "Gtd-Test-Fix:"
