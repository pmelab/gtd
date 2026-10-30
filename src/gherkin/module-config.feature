@inmem
Feature: a scenario runs a workflow module from disk

  The test runner imports the module, so it shares the engine's runtime and
  may import anything on disk. A config written as source can import only
  files inside the in-memory repository.

  Scenario: the module's default export starts on a change in the tree
    Given a gtd config from the module "src/gherkin/tiny.fixture.ts"
    And a file "IDEA.md" with:
      """
      a calculator
      """
    And step "plan" writes "PLAN.md" with:
      """
      add two numbers
      """
    When the process is driven
    Then the process rests at "sign-off"
    And the commit subjects end with:
      """
      gtd(agent): plan → sign-off
      gtd(check): pin → sign-off
      """

