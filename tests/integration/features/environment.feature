@live
Feature: Hostile environments and unusual invocations

  gtd derives everything from the repository it is invoked in. These scenarios
  pin the behavior at the environment's edges: wrong cwd, missing repo, empty
  repo, unusual HEADs, user hooks, platform line endings, signing, and
  submodules.

  # Steering files and diff pathspecs are resolved against the process cwd, so
  # anywhere but the repo root would silently mis-derive state — gtd refuses
  # with a clear error instead (decided spec, grilled 2026-07-02).
  Scenario: Running gtd from a subdirectory refuses with a clear repo-root error
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      A converged plan.

      no open questions — run gtd to plan
      """
    And a directory "src"
    When I run gtd from the subdirectory "src"
    Then it fails
    And stderr contains "repository root"

  Scenario: Running gtd outside a git repository fails cleanly
    Given a plain directory that is not a git repository
    When I run gtd
    Then it fails
    And stderr contains "gtd:"

  Scenario: A fresh repository with no commits seeds a new feature from the empty tree
    Given a fresh git repository with no commits
    And a file "src/idea.ts" with:
      """
      export const idea = () => 42
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: new task"
    And the last commit subject is "gtd: grilling"
    And the file "TODO.md" contains "src/idea.ts"

  Scenario: A detached HEAD on branch work still reviews from the merge-base
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: detached work" that adds "src/work.ts" with:
      """
      export const work = () => 1
      """
    And the repository is in detached HEAD state
    When I run gtd
    Then it succeeds
    And stdout contains "help a human to review the changes"
    And stdout contains "src/work.ts"

  # A merge commit at HEAD is documented-unsupported (STATES.md): the machine
  # folds first-parent history only. It must degrade gracefully — no crash,
  # no destructive action — on the default branch it settles Idle.
  Scenario: A merge commit at HEAD degrades gracefully
    Given a test project
    And a gtd config file at "." with:
      """
      testCommand: npm run test
      """
    And a merge commit merging a branch with a commit "feat: side work" that adds "src/side.ts" with:
      """
      export const side = () => 1
      """
    Then I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And the commit count is unchanged

  Scenario: A transport commit as the root commit fails with a clear error
    Given a fresh git repository with no commits
    And a file "work.ts" with:
      """
      export const carried = 1
      """
    And the working tree is committed as "gtd: transport"
    When I run gtd
    Then it fails
    And stderr contains "cannot reset transport commit"

  Scenario: A pre-commit hook that reformats steering files does not break the flow
    Given a test project
    And prettier is available in the test project
    And the working tree is committed as "chore: prettier config"
    And an executable pre-commit hook with:
      """
      #!/bin/sh
      FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^(TODO|REVIEW)\.md$')
      if [ -n "$FILES" ]; then
        npx prettier --write $FILES
        git add $FILES
      fi
      """
    And a file "TODO.md" with:
      """
      # Plan

      This is a very long line that exceeds eighty characters and will be wrapped by the hook on commit.

      no open questions — run gtd to plan
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    When I run gtd
    Then it succeeds

  Scenario: A failing pre-commit hook surfaces the error and the flow resumes after removal
    Given a test project
    And an executable pre-commit hook with:
      """
      #!/bin/sh
      echo "hook rejected" >&2
      exit 1
      """
    And a file "src/idea.ts" with:
      """
      export const idea = () => 1
      """
    When I run gtd
    Then it fails
    Given the pre-commit hook is removed
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: new task"
    And the last commit subject is "gtd: grilling"

  # A CRLF editor rewrites every line ending; the checkbox-only detector
  # treats identical-after-\r pairs as churn so pure ticking still approves.
  Scenario: Checkbox approval survives a CRLF editor
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And "REVIEW.md" is modified with CRLF line endings to:
      """
      # Review

      - [x] ./src/calc.ts#1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: done"
    And the file "REVIEW.md" does not exist

  Scenario: Unusable commit signing surfaces a clean error
    Given a test project
    And git config "commit.gpgsign" is "true"
    # Pin the signing mechanism locally: a host-level `gpg.format = ssh` (e.g.
    # 1Password's signer in the developer's global config) would otherwise
    # bypass gpg.program entirely and sign successfully.
    And git config "gpg.format" is "openpgp"
    And git config "gpg.program" is "/nonexistent-gpg-binary"
    And a file "src/idea.ts" with:
      """
      export const idea = () => 1
      """
    When I run gtd
    Then it fails

  Scenario: A submodule pointer change is routed as a code change without crashing
    Given a test project
    And a committed submodule at "vendor/dep"
    And the submodule at "vendor/dep" has a new commit
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: new task"
    And the last commit subject is "gtd: grilling"
    And the file "TODO.md" exists
