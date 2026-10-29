@live @tarball
Feature: docs/testing.md's examples — doc-tested against the packed tarball

  docs/testing.md shows a workflow with a `node:test` test, and the same test
  as a gherkin scenario. These scenarios write the files exactly as the doc
  prints them into a project that installed gtd's packed tarball, run the
  command the doc gives, and expect them to pass: the testkit works from the
  package alone, the plain test with no test runner but Node's, and the docs
  stay true.

  Background:
    Given a test project
    And npm has installed gtd's packed tarball, beside typescript, vitest, quickpickle and @types/node linked from this checkout, into the test project's package.json and node_modules

  Scenario: the complete workflow test passes under node:test
    Given the files docs/testing.md shows under "## A complete workflow test"
    When I run the command docs/testing.md shows under "## A complete workflow test" within 110 seconds
    Then it succeeds
    And stdout contains "pass 1"

  Scenario: the gherkin example passes under vitest
    Given the files docs/testing.md shows under "## A complete workflow test"
    And the files docs/testing.md shows under "## Gherkin steps"
    And npx finds the linked vitest
    When I run the command docs/testing.md shows under "## Gherkin steps" within 110 seconds
    Then it succeeds
    And stdout contains "1 passed"
