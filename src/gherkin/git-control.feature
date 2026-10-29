@inmem
Feature: a scenario controls the commands and the history a workflow sees

  A step's script may run programs the in-memory repository has none of: a
  canned command stands in for each, matched by the command as the script
  spells it. Branches and refs are set up before the process starts, so a
  workflow that reads another branch or a remote ref finds them.

  Background:
    Given a gtd config with:
      """
      import { check, human, run, showScript, workflow } from "@pmelab/gtd/flows"

      export const tested = workflow(async () => {
        const green = await check("test", "npm test", ".gtd/FEEDBACK.md")
        await human(green ? "sign-off" : "red")
      })

      export const restored = workflow(async () => {
        await run("restore", showScript("origin/main", "a.txt", "a.txt"))
        await human("done")
      })

      export default tested
      """
    And a file "a.txt" with:
      """
      base
      """
    And the working tree is committed as "chore: base"

  Scenario: a red canned command writes its output to the check's report
    Given the command "npm test" exits 1 with:
      """
      1 failing
      """
    And step "test" runs its script
    When gtd starts workflow "tested"
    And the process is driven
    Then the process rests at "red"
    And ".gtd/FEEDBACK.md" contains "1 failing"

  Scenario: a green canned command passes the check
    Given the command "npm test" exits 0
    And step "test" runs its script
    When gtd starts workflow "tested"
    And the process is driven
    Then the process rests at "sign-off"

  Scenario: a command no canned command matches fails the drive, naming it
    Given step "test" runs its script
    When gtd starts workflow "tested"
    Then driving the process is refused with "no canned command matches `npm test`"

  Scenario: a remote ref is read by its short name
    Given the ref "refs/remotes/origin/main" points at HEAD
    And a file "a.txt" with:
      """
      local
      """
    And the working tree is committed as "chore: local"
    And step "restore" runs its script
    When gtd starts workflow "restored"
    And the process is driven
    Then the process rests at "done"
    And "a.txt" contains "base"

  Scenario: a branch is checked out and back
    Given a branch "feature/x"
    And "feature/x" is checked out
    And a file "a.txt" with:
      """
      feature
      """
    And the working tree is committed as "feat: x"
    And "main" is checked out
    Then "a.txt" contains "base"
    And "a.txt" does not contain "feature"
