@inmem
Feature: the tests workflow revives skipped tests or proposes their deletion

  `gtd --workflow tests` sweeps the repository for skipped tests and test-audit
  findings into `.gtd/TESTS.md`, one section per test file. Each file is
  rewritten in its own turn until nothing in it is skipped and the suite is
  green. A test the agent calls obsolete stays skipped and becomes a proposal in
  `.gtd/RETIRE.md`; the human review asks for one tick on each — delete it, keep
  it skipped, or an own answer. Only a person's tick deletes a test.

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
      export { tests } from "@pmelab/gtd/workflows/tests"
      """
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/calc.test.ts" with:
      """
      it.skip("adds", () => expect(add(1, 2)).toBe(3))
      """
    And a file "src/legacy.test.ts" with:
      """
      it.skip("calls the v1 api", () => {})
      """
    And the working tree is committed as "feat: calculator"
    And step "tests-gate.check" changes nothing
    And step "tests.sweeping" writes ".gtd/TESTS.md" with:
      """
      # Tests

      ## src/calc.test.ts

      "adds" is skipped.

      ## src/legacy.test.ts

      "calls the v1 api" is skipped.
      """
    And step "tests.rewriting", when prompted with "\"adds\" is skipped", writes "src/calc.test.ts" with:
      """
      it("adds", () => expect(add(1, 2)).toBe(3))
      """
    And step "tests.rewriting", when prompted with "\"calls the v1 api\" is skipped", writes ".gtd/RETIRE.md" with:
      """
      # Retire

      ## calls the v1 api

      src/legacy.test.ts tests the v1 api, which is gone.
      """
    And step "tests.health.check" changes nothing
    And step "tests.closing" runs its script
    And step "build.review.composing" runs its script
    And step "build.review.closing" runs its script

  Scenario: the revivable test is unskipped and the obsolete one is proposed for deletion
    When gtd starts workflow "tests"
    And the process is driven
    Then the process rests at "build.review.await-review"
    And the commit subjects end with:
      """
      gtd(check): tests-gate.check → tests.sweeping
      gtd(agent): tests.sweeping → tests.rewriting
      gtd(agent): tests.rewriting → tests.health.check
      gtd(check): tests.health.check → tests.rewriting
      gtd(agent): tests.rewriting → tests.health.check
      gtd(check): tests.health.check → tests.closing
      gtd(check): tests.closing → build.review.composing
      gtd(check): build.review.composing → build.review.await-review
      """
    And "src/calc.test.ts" contains "it(\"adds\""
    And "src/legacy.test.ts" contains "it.skip"
    And ".gtd/TESTS.md" does not exist
    And ".gtd/RETIRE.md" does not exist
    And ".gtd/REVIEW.md" contains:
      """
      ## calls the v1 api

      Delete this skipped test.

      src/legacy.test.ts tests the v1 api, which is gone.

      Tick exactly one:

      - [ ] delete it
      - [ ] keep it skipped
      - [ ] _your answer_
      """
    And the resting step's content contains "gtd never"

  Scenario: signing off with an unticked proposal is refused
    When gtd starts workflow "tests"
    And the process is driven
    Then landing is refused with "tick exactly one box"

  Scenario: a ticked delete it has the test deleted, then the review comes back
    Given step "build.review.fix.nits.fixing" deletes "src/legacy.test.ts"
    And step "build.health.check" changes nothing
    When gtd starts workflow "tests"
    And the process is driven
    And the text "- [ ] delete it" in ".gtd/REVIEW.md" is replaced with "- [x] delete it"
    And gtd lands
    And the process is driven
    Then the process rests at "build.review.await-review"
    And "src/legacy.test.ts" does not exist
    When gtd lands
    And the process is driven
    Then the process rests at "idle"

  Scenario: a ticked keep it skipped leaves the test skipped and ends the process
    When gtd starts workflow "tests"
    And the process is driven
    And the text "- [ ] keep it skipped" in ".gtd/REVIEW.md" is replaced with "- [x] keep it skipped"
    And gtd lands
    And the process is driven
    Then the process rests at "idle"
    And "src/legacy.test.ts" contains "it.skip"
    And no commit body contains "Gtd-Mark: wontfix=delete"

  Scenario: a rewrite leaving a test skipped without a proposal is refused
    Given step "tests.rewriting", when prompted with "\"calls the v1 api\" is skipped", writes ".gtd/RETIRE.md" with:
      """
      # Retire
      """
    When gtd starts workflow "tests"
    Then driving the process is refused with "src/legacy.test.ts:1 still skipped"

  Scenario: a rewrite deleting a test file is refused
    Given step "tests.rewriting" deletes "src/legacy.test.ts"
    When gtd starts workflow "tests"
    Then driving the process is refused with "src/legacy.test.ts deleted"

  Scenario: a sweep leaving out a file with a skipped test is refused
    Given step "tests.sweeping" writes ".gtd/TESTS.md" with:
      """
      # Tests

      ## src/calc.test.ts

      "adds" is skipped.
      """
    When gtd starts workflow "tests"
    Then driving the process is refused with "src/legacy.test.ts has no section"

  Scenario: the sweep is told every skipped test, path and line
    Given step "tests.sweeping" is prompted with "src/legacy.test.ts:1 — it.skip(\"calls the v1 api\", () => {})"
    When gtd starts workflow "tests"
    And the process is driven
    Then the process rests at "build.review.await-review"

  Scenario: a sweep with nothing to do ends the process
    Given a file "src/calc.test.ts" with:
      """
      it("adds", () => expect(add(1, 2)).toBe(3))
      """
    And the file "src/legacy.test.ts" is deleted
    And the working tree is committed as "test: revive by hand"
    And step "tests.sweeping" from now on changes nothing
    When gtd starts workflow "tests"
    And the process is driven
    Then the process rests at "idle"

  Scenario: gtd door tests starts the workflow
    When gtd opens door "tests"
    And the process is driven
    Then the process rests at "build.review.await-review"
