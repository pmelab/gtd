@inmem
Feature: `$NAME` interpolation over every `.gtdrc` string value

  Every string leaf of a decoded `.gtdrc` layer expands `$NAME`/`${NAME}` from
  the process environment, `$$` yields a literal `$`, and an unset name is a
  load error that exits 1. `modes.*.format`, `modes.*.validate` and `ui.format`
  are exempt, because gtd hands their value to bash, where `$` is already the
  shell's own.

  Scenario: a "vars:" value of "$BUILD_MODEL" resolves from the environment
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        greeting: $BUILD_MODEL
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await human("second", { message: vars.greeting })
      }
      """
    And an environment variable "BUILD_MODEL" set to "opus"
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → second"
    When I run gtd next
    Then it succeeds
    And stdout contains "opus"

  Scenario: an unset "$BUILD_MODEL" exits 1, with the config path named in the message
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        greeting: $BUILD_MODEL
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "vars.greeting"
    And stderr contains "\"$BUILD_MODEL\""
    And stderr contains "not set"

  # $GTD_FILE is not set in the environment, so if the exemption were missing,
  # config load would fail before gtd even resolves the state. "gtd validate"
  # additionally proves the verbatim "$GTD_FILE" still reaches bash and gets
  # substituted with the real path — the scripted double is keyed by that
  # already-substituted command string.
  Scenario: a "modes:" "validate:" command keeps its "$GTD_FILE" verbatim and still runs
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          validate: "adr-lint $GTD_FILE"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("drafting", "write the ADR", { file: ".gtd/docs/adr.md", mode: "adr" })
      }
      """
    And the shell command "adr-lint .gtd/docs/adr.md" exits 0 with:
      """
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR
      """
    And gtd lands "gtd(human): idle → drafting"
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/docs/adr.md: valid"

  Scenario: "ui.format" keeps its "$GTD_FILE" verbatim
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      ui:
        format: "oxfmt --write \"$GTD_FILE\""
      """
    When I run gtd next
    Then it succeeds

  Scenario: "$$" in a var lands as exactly one "$"
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        price: $$5
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await human("second", { message: vars.price })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → second"
    When I run gtd next
    Then it succeeds
    And stdout contains "$5"

  Scenario: a value with a bare "$" and no following name survives untouched
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        label: "5$"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await human("second", { message: vars.label })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → second"
    When I run gtd next
    Then it succeeds
    And stdout contains "5$"

  # No `.gtdrc` key accepted today is itself an array of strings — that key
  # arrives with the next package, and this is the seam the two compose on.
  # Proven here through the diagnostic instead: the unset name inside the
  # SECOND array element resolves to path "vars.list.1", which only happens
  # if the pass recursed into the array rather than skipping it as a whole.
  Scenario: a "$NAME" inside an array value expands — proven by its diagnostic's indexed path
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        list: ["first", "$MISSING"]
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "vars.list.1"
    And stderr contains "\"$MISSING\""
    And stderr contains "not set"
