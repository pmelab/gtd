@inmem
Feature: gtd --entry <state> — start a brand new process at a declared state

  `gtd --entry <state>` (always authenticated as `human`) replaces the two
  former named commands `gtd review <commitish>`/`gtd fix` with one generic
  entry mechanism: `<state>` may be ANY declared, non-commit state — not just
  one flagged `entry: true` (that flag only seeds `entries.manual`, the
  reachability-root set). Repeatable `--var <name>=<value>` supplies that new
  process's fixed `it.vars` overrides, which must already be declared by the
  workflow's own `vars:` (or `.gtdrc` `vars:`).

  The bundled unified template declares `entries.manual` as exactly
  `["fix-precheck", "review-gate.check", "start-gate.check"]`, but only
  `review-gate.check` and `fix-precheck` are meant to actually be entered this
  way in practice. `review-gate.check`
  declares a template-form `reviewBase: "<%= it.vars.reviewBase %>"` — entering
  it FIXES the whole process's diff base to whatever `--var
  reviewBase=<commitish>` renders to; the default empty string renders blank,
  which is refused, so a review entry always requires an explicit `--var
  reviewBase=<commitish>`. `fix-precheck` declares no `reviewBase` and needs no
  `--var`.

  Resting at the initial state is required — a process already underway
  refuses. The working tree need not be clean: whatever it carries is CAPTURED
  into the entry commit (`commitAllWithPrefix`), exactly like an ordinary `gtd
  land`.

  Background:
    Given a test project
    And the workflow

  Scenario: happy path — a local branch entered for review via the space-separated "--entry" form, gated then resting at build.review.reviewing
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "--entry review-gate.check --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"
    # The green-baseline gate: a clean tree (tests pass) advances to build.review.reviewing.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): review-gate.check → build.review.reviewing"
    When I run gtd next
    Then it succeeds
    # The reviewing prompt NAMES the fixed base rather than inlining its diff.
    And stdout contains the hash of "base"
    And stdout does not contain "## Full diff under review"
    And stdout does not contain "diff --git"

  Scenario: the "--entry=<state>" equals-sign form works identically to the space-separated form
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "--entry=review-gate.check --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"

  Scenario: gtd --entry fix-precheck also enters the fix-entry gate — see fix-entry.feature for the deep coverage
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"

  Scenario: a dirty working tree is captured into the entry commit, not refused
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "scratch.txt" with:
      """
      not committed yet
      """
    When I run gtd with args "--entry review-gate.check --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"

  Scenario: fails with a clear usage error when the state name is not declared
    Given a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do it"
                on:
                  "* **": idle
      """
    When I run gtd with args "--entry review-gate.check"
    Then it fails
    And stderr contains "is not an enterable state"

  Scenario: refuses entering a commit state — a commit state is never enterable
    When I run gtd with args "--entry done"
    Then it fails
    And stderr contains "is not an enterable state"

  Scenario: refuses when a gtd process is already underway
    Given a file "NOTE.md" with:
      """
      a sketch
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "--entry review-gate.check"
    Then it fails
    And stderr contains "a process is already underway"
    And the commit count is unchanged

  Scenario: refuses an undeclared "--var" name
    When I run gtd with args "--entry review-gate.check --var bogus=1"
    Then it fails
    And stderr contains "--var name(s) not declared by this workflow"

  Scenario: refuses entering the review gate with no "reviewBase" var supplied — the default renders blank
    When I run gtd with args "--entry review-gate.check"
    Then it fails
    And stderr contains "'s reviewBase template rendered blank — template:"

  Scenario: refuses a "reviewBase" that is not an ancestor of HEAD
    Given a commit "feat: shared work" that adds "shared.txt" with:
      """
      shared
      """
    And I mark the current commit as "shared"
    And a commit "feat: branch a work" that adds "a.txt" with:
      """
      a
      """
    And I mark the current commit as "branch-a"
    And I hard-reset to "shared"
    And a commit "feat: branch b work" that adds "b.txt" with:
      """
      b
      """
    When I run gtd with args "--entry review-gate.check --var reviewBase=branch-a"
    Then it fails
    And stderr contains "is not an ancestor of HEAD"

  Scenario: refuses a "reviewBase" that resolves to HEAD — nothing to review
    Given I mark the current commit as "here"
    When I run gtd with args "--entry review-gate.check --var reviewBase=here"
    Then it fails
    And stderr contains "is HEAD — nothing to review"
