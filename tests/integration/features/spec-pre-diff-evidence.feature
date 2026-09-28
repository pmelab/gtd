Feature: packages.item.spec.pre's evidence carries the package's own diff, filtered

  The pre-judge no longer tells the judge to read a range itself: its
  evidence map carries a `diff` key — a unified diff of exactly what this
  package's own build produced, with lockfiles and other generated noise
  excluded before it ever reaches the judge.

  @inmem
  Scenario: a package build that touches both a source file and a lockfile hands the judge the source hunks and none of the lockfile
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Widget
      - [ ] add src/widget.ts, exported as the default widget builder
      """
    And gtd lands "gtd(check): architecture-promote → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And a file "package-lock.json" with:
      """
      {
        "name": "widget-factory",
        "lockfileVersion": 3,
        "dependencies": { "left-pad": { "version": "1.0.0" } }
      }
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    When I run gtd with args "judge"
    Then it succeeds
    And stdout contains "+export const widget = 1"
    And stdout contains "src/widget.ts"
    And stdout does not contain "package-lock.json"
    And stdout does not contain "left-pad"
