@inmem
Feature: Retry redirection — a state's entry cap redirects at write time

  A retry cap is a plain loop counter in flow code: once the fix step has
  run `max` times within the current process, the next red check hands to the
  fallback step instead — and because the landing's target is computed by
  replaying the flow, the fallback is what actually lands in history.

  Scenario: repeated check failures redirect to "otherwise" once the cap is reached
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("start", { message: "go" })
          let fixes = 0
          for (;;) {
            await run("checking", "npm test")
            if (added("FEEDBACK.md").length === 0) break
            if (fixes >= 1) {
              await human("escalate", { message: "stuck" })
              break
            }
            fixes++
            await agent("fixing", "fix it")
          }
          await human("done", { message: "done" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      go
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → checking"
    Given a file "FEEDBACK.md" with:
      """
      test failed (attempt 1)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → fixing"
    Given the file "FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): fixing → checking"
    Given a file "FEEDBACK.md" with:
      """
      test failed (attempt 2)
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → escalate"

  Scenario: a retry cap of 0 redirects on the very first entry attempt
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("start", { message: "go" })
          let fixes = 0
          for (;;) {
            await run("checking", "npm test")
            if (added("FEEDBACK.md").length === 0) break
            if (fixes >= 0) {
              await human("escalate", { message: "stuck" })
              break
            }
            fixes++
            await agent("fixing", "fix it")
          }
          await human("done", { message: "done" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      go
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → checking"
    Given a file "FEEDBACK.md" with:
      """
      test failed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): checking → escalate"
