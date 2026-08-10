@live
Feature: Emitted required/optional scripts print their own outcome lines

  A `gtd step`/`gtd abandon`/`gtd restore` invocation no longer performs its
  own git write, and the driver that DOES (this suite's own `world.ts`, or
  `bin/gtd`) no longer re-derives the commit grammar or re-prints the write
  commands' wording itself either: the emitted `required` script prints its
  own human-facing outcome line (`src/OutcomeScript.ts`'s `gtd_report_*`
  calls), so ANY driver — this suite, `bin/gtd`, or a human pasting `required`
  into a terminal — sees the same feedback. `@live` only: the in-memory tier
  never runs an emitted script's outcome block (it recognizes the block as
  inert and prints nothing — see `src/testing/EmittedScriptRecognizer.ts`'s
  own doc comment), so these scenarios would prove nothing under `@inmem`.

  Background:
    Given a test project
    And a gtd config file at ".gtdrc" with:
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
                message: "start"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "go"
      """

  Scenario: a landed transition's required script prints the transition row and its changed-file rows
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd step human
    Then it succeeds
    And the emitted script printed "-> idle → working"
    And the emitted script printed "src/a.ts"

  Scenario: a no-op step's required script is print-only, naming the resting state
    When I run gtd step human
    Then it succeeds
    And stdout contains "nothing to do at \"idle\""
    And the emitted script printed "nothing to do at \"idle\""

  Scenario: gtd abandon's script resolves the post-hoc short hash and subject from the resulting HEAD
    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"

    When I run gtd with args "abandon"
    Then it succeeds
    And the emitted script printed "abandoned the process resting at \"working\""
    And the emitted script printed "chore: add .gtdrc"
    And the emitted script printed "resting at \"idle\""
