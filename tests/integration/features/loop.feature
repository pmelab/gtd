@live
Feature: gtd loop drives a process until it rests on a human

  `gtd loop` advances beats: it reads `gtd next --json`, runs the agent turn
  or script a beat demands, and lands the result through `gtd land --json`'s
  script. A real `claude` is never invoked: the stub agent step puts a
  `claude` shim on $PATH that runs the scenario's own script. The shim
  exposes the prompt as $GTD_LOOP_PROMPT and the model the loop passed as
  $GTD_LOOP_MODEL. The loop's own decisions — gates, stalls, judge gates,
  model hints — are unit-tested against a fake host; these scenarios prove
  it drives real processes.

  Scenario: Runs a fixture workflow to completion with a fake agent, through a failed check and a second turn
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, run } from "@pmelab/gtd/flows"

      const red = (): boolean => changes(".gtd/FEEDBACK.md").some((c) => c.status !== "deleted")

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        do {
          await agent(
            "working",
            "Build the package described below: write src/calc.ts exporting add(a, b).",
          )
          await run(
            "checking",
            `if [ -f src/calc.ts ] && grep -q add src/calc.ts; then rm -f .gtd/FEEDBACK.md; else mkdir -p .gtd && echo "missing add" > .gtd/FEEDBACK.md; fi`,
          )
        } while (red())
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And an empty user-level loop config
    And a stub agent script that responds to prompts with:
      """
      mkdir -p src
      if [ -f src/calc.ts ]; then
        echo 'export const add = (a, b) => a + b' > src/calc.ts
        echo '{"result":"wrote add","is_error":false,"total_cost_usd":0.25}'
      else
        echo 'export const sub = (a, b) => a - b' > src/calc.ts
        echo '{"result":"wrote sub","is_error":false,"total_cost_usd":0.25}'
      fi
      """
    When I run gtd loop
    Then it succeeds
    And stderr contains "● done — idle"
    And "src/calc.ts" contains "add"
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: add gtd.config.ts
      gtd(human): idle → working
      gtd(agent): working → checking
      gtd(check): checking → working
      gtd(agent): working → checking
      gtd(check): checking → idle
      """
    And the log file contains "─── beat #5"
    And the log file contains "wrote sub"
    And the log file contains "wrote add"
    And the log file does not contain "total_cost_usd"

  Scenario: Re-prompts the validator's whole output, stderr included, until the steering file passes
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("drafting", "Write .gtd/NOTES.md.", { file: ".gtd/NOTES.md", mode: "notes" })
      }

      export const config = {
        modes: {
          notes: {
            validate: "grep -q approved \"$GTD_FILE\" || { echo \"NOTES lacks the word approved\" >&2; exit 1; }",
          },
        },
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → drafting"
    And a file ".gtd/NOTES.md" with:
      """
      a prior draft, about to be overwritten
      """
    And an empty user-level loop config
    And a stub agent script that responds to prompts with:
      """
      case "$GTD_LOOP_PROMPT" in
        "Your last turn does not pass"*"NOTES lacks the word approved"*)
          echo "FIX PROMPT WAS: $GTD_LOOP_PROMPT"
          echo "approved" > .gtd/NOTES.md
          ;;
        *)
          echo "draft" > .gtd/NOTES.md
          ;;
      esac
      """
    When I run gtd loop
    Then it succeeds
    And the log file contains "FIX PROMPT WAS: Your last turn does not pass"
    And the last commit subject is "gtd(agent): drafting → idle"

  Scenario Outline: A signal kills the loop with its promised status and takes the whole agent turn with it
    # Both the turn and the command it backgrounds ignore SIGTERM, so only the
    # loop's escalation to SIGKILL stops them.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "Build the package described below.")
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    And an empty user-level loop config
    And a stub agent script that responds to prompts with:
      """
      trap "" TERM
      sh -c 'sleep 30' &
      echo $! > "$GTD_TEST_AGENT_MARKER.child"
      echo $$ > "$GTD_TEST_AGENT_MARKER"
      wait
      """
    When I send <signal> to a spawned gtd loop mid agent turn
    Then the child was still alive when the signal landed
    And the reported exit status is <status>
    And the interrupted agent turn and its descendants are no longer running
    And the last commit subject is "gtd(human): idle → working"

    Examples:
      | signal  | status |
      | SIGINT  | 130    |
      | SIGTERM | 143    |
      | SIGHUP  | 129    |
