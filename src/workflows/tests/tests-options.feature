@inmem
Feature: the tests workflow's skip detection is a workflow option

  `testFiles` (globs) and `skipPattern` (a per-line regular expression) default
  to JavaScript/TypeScript runners and cucumber tags; another stack sets its
  own on the factory.

  Background:
    Given a gtd config with:
      """
      export {
        feature as default,
        feature,
        defaults,
        envDefaults,
        summary,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows/feature"
      import { tests as shippedTests } from "@pmelab/gtd/workflows/tests"
      export const tests = shippedTests({
        testFiles: "tests/test_*.py",
        skipPattern: "@pytest\\.mark\\.skip\\b",
      })
      """
    And a file "tests/test_calc.py" with:
      """
      @pytest.mark.skip
      def test_add(): pass
      """
    And a file "src/calc.test.ts" with:
      """
      it.skip("adds", () => {})
      """
    And the working tree is committed as "test: python"
    And step "tests-gate.check" changes nothing

  Scenario: only the configured files and pattern count as skipped
    Given step "tests.sweeping" is prompted with "tests/test_calc.py:1 — @pytest.mark.skip"
    And step "tests.sweeping" changes nothing
    When gtd starts workflow "tests"
    Then driving the process is refused with "tests/test_calc.py has no section"
    And driving the process is refused without "src/calc.test.ts"

  Scenario Outline: an unusable skipPattern is refused before any step
    Then starting workflow "tests" with "--var skipPattern=<pattern>" is refused with "<refusal>"

    Examples:
      | pattern | refusal                                     |
      | .*      | skipPattern must not match the empty string |
      | (       | skipPattern is not a valid regular expression |
