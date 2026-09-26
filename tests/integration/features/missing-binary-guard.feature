@live
Feature: A declared mode command guards its own missing binary

  A mode's `format:`/`validate:` command is rendered into the driver's own
  shell, not spawned by gtd — a typo'd or uninstalled binary used to surface
  as a raw non-zero exit the driver's shell produced, with no clue which mode
  or command was to blame. `src/Emit.ts`'s `binaryGuard` re-renders the
  diagnostic `CommandRunner` used to give (see `src/SteeringMode.test.ts` at
  base commit `758c0993`) as a shell line emitted immediately ahead of the
  command it guards: a `command -v` probe that names the mode, the command
  key, and the resolved `$PATH` before exiting 127 — bash's own "command not
  found" status — when the binary is not on it.

  The guard only fires for a command with exactly one unambiguous leading
  binary. A `VAR=x`-prefixed command or a pipeline has no single binary to
  probe, so gtd emits nothing ahead of it — a missing guard degrades to
  today's raw exit, but a wrong guard would refuse a command that works.

  Scenario: a mode's validate: command names an uninstalled binary and the resolved $PATH
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          validate: "gtd-test-nonexistent-binary <%= it.file %>"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start a decision record" })
          await agent("drafting", "Write the ADR.", { file: ".gtd/docs/adr.md", mode: "adr" })
        },
      })
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And gtd lands "gtd(human): idle → drafting"
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "mode \"adr\": \"validate\" command not found: gtd-test-nonexistent-binary"
    And stderr contains "gtd-path-shim"

  Scenario: a mode's format: command names an uninstalled binary and the resolved $PATH
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          format: "gtd-test-nonexistent-formatter <%= it.file %>"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start a decision record" })
          await agent("drafting", "Write the ADR.", { file: ".gtd/docs/adr.md", mode: "adr" })
        },
      })
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And gtd lands "gtd(human): idle → drafting"
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "mode \"adr\": \"format\" command not found: gtd-test-nonexistent-formatter"
    And stderr contains "gtd-path-shim"

  Scenario: a pipeline validate: command emits no guard — an uninstalled binary inside it still exits raw, not with the guard's own message
    # POSIX sh has no `pipefail` — a pipeline's exit status is its LAST
    # command's, so the missing binary on the left doesn't even fail the
    # script here. That is exactly the point: nothing in this suite may add
    # `pipefail` on gtd's behalf, so the only thing this scenario can pin is
    # that the guard's OWN crafted wording never appears — a raw shell
    # "command not found" from the missing left-hand command is fine; a
    # second, gtd-authored one naming "adr"/"validate" would mean the
    # extractor wrongly treated a pipeline as a single unambiguous binary.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          validate: "gtd-test-nonexistent-binary <%= it.file %> | cat"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start a decision record" })
          await agent("drafting", "Write the ADR.", { file: ".gtd/docs/adr.md", mode: "adr" })
        },
      })
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And gtd lands "gtd(human): idle → drafting"
    When I run gtd with args "validate"
    Then it succeeds
    And stdout does not contain "mode \"adr\": \"validate\" command not found"

  Scenario: a VAR=x-prefixed validate: command emits no guard
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        adr:
          validate: "FOO=1 gtd-test-nonexistent-binary <%= it.file %>"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "start a decision record" })
          await agent("drafting", "Write the ADR.", { file: ".gtd/docs/adr.md", mode: "adr" })
        },
      })
      """
    And a file ".gtd/docs/adr.md" with:
      """
      # ADR 1: use gtd
      """
    And gtd lands "gtd(human): idle → drafting"
    When I run gtd with args "validate"
    Then it fails
    And stderr does not contain "command not found: gtd-test-nonexistent-binary"
