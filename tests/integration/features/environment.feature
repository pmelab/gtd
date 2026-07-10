@live
Feature: Hostile environments and unusual invocations

  gtd derives everything from the repository it is invoked in. These scenarios
  pin the behavior at the environment's edges: wrong cwd, missing repo, empty
  repo, unusual HEADs, user hooks, platform line endings, signing, and
  submodules — driven through `gtd step` / `gtd status` as the assertion needs.

  # Steering files and diff pathspecs are resolved against the process cwd, so
  # anywhere but the repo root would silently mis-derive state — gtd refuses
  # with a clear error instead (decided spec, grilled 2026-07-02). The only
  # available subdirectory-invocation step drives bare `gtd`, which now fails
  # on the missing-command usage check before it ever reaches the repo-root
  # guard — this scenario pins that bare gtd still fails cleanly (no crash, no
  # deadlock) from a subdirectory rather than the repo-root error text itself.
  Scenario: Bare gtd from a subdirectory still fails cleanly, without deadlocking
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan

      A converged plan.
      """
    And a directory "src"
    When I run gtd from the subdirectory "src"
    Then it fails
    And stdout contains "Usage"

  Scenario: Running gtd outside a git repository fails cleanly
    Given a plain directory that is not a git repository
    When I run gtd status
    Then it fails
    And stderr contains "gtd:"

  Scenario: A fresh repository with no commits seeds the first grilling turn from the empty tree
    Given a fresh git repository with no commits
    And a file "src/idea.ts" with:
      """
      export const idea = () => 42
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And the file "src/idea.ts" exists
    And the file "src/idea.ts" contains "export const idea"

  Scenario: A detached HEAD on branch work settles idle via the health check
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a gtd config file at "." with:
      """
      testCommand: "true"
      """
    And a commit "feat: detached work" that adds "src/work.ts" with:
      """
      export const work = () => 1
      """
    And the repository is in detached HEAD state
    When I run gtd step
    Then it succeeds
    And stdout contains "state: idle"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd next
    Then it succeeds
    And stdout does not contain "help a human to review the changes"

  # A merge commit at HEAD is documented-unsupported (STATES.md): the machine
  # folds first-parent history only. It must degrade gracefully — no crash,
  # no destructive action — on the default branch it settles idle.
  Scenario: A merge commit at HEAD degrades gracefully
    Given a test project
    And a gtd config file at "." with:
      """
      testCommand: 'true'
      """
    And a merge commit merging a branch with a commit "feat: side work" that adds "src/side.ts" with:
      """
      export const side = () => 1
      """
    Then I record the commit count
    When I run gtd step
    Then it succeeds
    And stdout contains "state: idle"
    And the commit count is unchanged

  # `gtd: transport` was a v1 special-case subject; in v2 it falls outside the
  # closed turn/routing grammar, so even as the very first (root) commit of a
  # fresh repository it is just an inert boundary commit — a later dirty tree
  # still enters grilling normally instead of hitting the old revert path.
  Scenario: A v1 gtd: transport root commit is inert boundary history, not a special case
    Given a fresh git repository with no commits
    And a file "work.ts" with:
      """
      export const carried = 1
      """
    And the working tree is committed as "gtd: transport"
    And a file "src/idea.ts" with:
      """
      export const idea = 1
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"

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
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    When I run gtd step
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
    When I run gtd step
    Then it fails
    Given the pre-commit hook is removed
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"

  # A CRLF editor rewrites every line ending; the checkbox-only detector
  # treats identical-after-\r pairs as churn so pure ticking still approves.
  Scenario: Checkbox approval survives a CRLF editor
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      squash: false
      """
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(agent): review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And a commit "gtd: awaiting review"
    And "REVIEW.md" is modified with CRLF line endings to:
      """
      # Review

      - [x] ./src/calc.ts#1
      """
    When I run gtd step
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
    When I run gtd step
    Then it fails

  Scenario: A submodule pointer change is routed as a code change without crashing
    Given a test project
    And a committed submodule at "vendor/dep"
    And the submodule at "vendor/dep" has a new commit
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And the file "TODO.md" does not exist

  # --version and --help must short-circuit before any repo-state work so they
  # never deadlock on unusual or broken repo states. These scenarios pin that
  # the flag short-circuit fires before the "no precedence rule matched" guard.

  Scenario: --version exits 0 from a dirty gtd: health-check state without deadlocking
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      bash impl.sh
      """
    And a gtd config file at "." with:
      """
      testCommand: bash gate.sh
      squash: false
      """
    And a commit "feat: initial feature" that adds "impl.sh" with:
      """
      exit 1
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd: health-check"
    Given "impl.sh" is modified to:
      """
      exit 0
      """
    When I run gtd with "--version"
    Then it succeeds
    And stderr does not contain "no precedence rule matched"
    And stdout contains "1."

  Scenario: --help exits 0 and prints usage from a fresh project
    Given a test project
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "Usage"
    And stdout contains "format"
    And stdout contains "review"

  Scenario: --version exits 0 outside a git repository
    Given a plain directory that is not a git repository
    When I run gtd with "--version"
    Then it succeeds
    And stdout contains "1."

  Scenario: --help exits 0 outside a git repository
    Given a plain directory that is not a git repository
    When I run gtd with "--help"
    Then it succeeds
    And stdout contains "Usage"
