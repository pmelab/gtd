@inmem
Feature: a process gtd started without a gtd.config.ts continues once one exists

  Before gtd stopped shipping its workflows as a built-in default, a repository
  with no `gtd.config.ts` ran them anyway. A process such a gtd started records
  what it ran the same way every process does: an ordinary start records no
  workflow (it replays on the default export), a door or `--workflow` start
  records `Gtd-Workflow: <name>`. After the upgrade, `gtd install` writes a
  config exporting the shipped workflows under those same names, and the
  process picks up where it stopped. The opening commits below are verbatim
  what gtd 20.3.0 wrote; each continuation is the commit 20.3.0 itself wrote
  next.

  Scenario: until a config exists, the process is told to run gtd install
    Given a test project
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(human): idle → unwind

      Gtd-Step: idle#1
      Gtd-Var: judgeBudgetBytes=32768
      Gtd-Var: judgeIdenticalMinP=0.7
      Gtd-Var: qualityReviews=correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge
      Gtd-Var: reviewBase=
      Gtd-Var: reviewNoteActionable=0.7
      Gtd-Format: 1
      """
    When I run gtd next
    Then it fails
    And stderr contains "run `gtd install`"

  Scenario: an ordinary start replays on the scaffolded default and lands its next turn
    Given a test project
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And the working tree is committed with message:
      """
      gtd(human): idle → unwind

      Gtd-Step: idle#1
      Gtd-Var: judgeBudgetBytes=32768
      Gtd-Var: judgeIdenticalMinP=0.7
      Gtd-Var: qualityReviews=correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge
      Gtd-Var: reviewBase=
      Gtd-Var: reviewNoteActionable=0.7
      Gtd-Format: 1
      """
    And I run gtd with args "install"
    When I run gtd next
    Then it succeeds
    And stdout contains "State: unwind"
    # What the unwind script does: revert the sketch.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"
    When I run gtd next
    Then it succeeds
    And stdout contains "State: start-gate.check"

  Scenario: a review door process replays on the scaffolded review and lands its next turn
    Given a test project
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And the working tree is committed with the hash of "base" substituted for "BASE" in message:
      """
      gtd(human): review-gate.check

      Gtd-Workflow: review
      Gtd-Review-Base: BASE
      Gtd-Var: judgeBudgetBytes=32768
      Gtd-Var: judgeIdenticalMinP=0.7
      Gtd-Var: qualityReviews=correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge
      Gtd-Var: reviewBase=base
      Gtd-Var: reviewNoteActionable=0.7
      Gtd-Format: 1
      """
    And I run gtd with args "install"
    When I run gtd next
    Then it succeeds
    And stdout contains "State: review-gate.check"
    And stdout contains "Workflow: review"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): review-gate.check → build.health.check"
