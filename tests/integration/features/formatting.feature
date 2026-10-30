@inmem
Feature: Markdown formatting is the project's own tool, plugged into a steering-file mode

  gtd ships no formatter (there is no `gtd format` subcommand, and no prettier
  inside the binary). A project that wants its steering files auto-formatted
  brings its own tool and declares it as a `format:` command on the mode those
  files use — a `config.modes` entry in `gtd.config.ts` is enough, without
  re-declaring that mode on the workflow itself (see docs/configuration.md's
  "Modes" section). Formatting runs where
  validation runs: `gtd validate`, and `gtd next --json`'s own `validate`
  field — never `gtd land`'s own emitted script any more (package 2,
  Requirement A): that script is only the HEAD assertion and the commit, so a
  driver that wants a steering file formatted before it lands must run the
  mode's format/validate script itself first.

  The formatter here is scripted: what it does to the text is the project's
  business; that gtd runs it, and when, is gtd's.

  Scenario: a formatter plugged into the workflow's qa mode via a top-level modes: key rewraps TODO.md
    Given a test project
    And the shell command "wrap-prose $GTD_FILE" rewrites "$GTD_FILE" to:
      """
      A plan, wrapped by the project's formatter.
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        for (;;) {
          await agent("grilling", "plan", { file: ".gtd/TODO.md", mode: "qa" })
          await human("grilling-answer", {
            file: ".gtd/TODO.md",
            mode: "qa",
            message: "answer",
            acceptClean: true,
          })
          if (changes().length === 0) return
        }
      }

      export const config = {
        modes: {
          qa: {
            format: "wrap-prose $GTD_FILE",
          },
        },
      }
      """
    And a file ".gtd/TODO.md" with:
      """
      This is a very long line that exceeds eighty characters and should be wrapped by the formatter when gtd validates it.
      """
    And gtd lands "gtd(human): idle → grilling"
    And I run the pin beat
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/TODO.md: valid"
    And ".gtd/TODO.md" has no lines longer than 80 characters

  Scenario: gtd land no longer formats before committing the turn — gtd validate is what still runs the mode's format command
    Given a test project
    And the shell command "wrap-prose $GTD_FILE" rewrites "$GTD_FILE" to:
      """
      A plan, wrapped by the project's formatter.
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        for (;;) {
          await agent("grilling", "plan", { file: ".gtd/TODO.md", mode: "qa" })
          await human("grilling-answer", {
            file: ".gtd/TODO.md",
            mode: "qa",
            message: "answer",
            acceptClean: true,
          })
          if (changes().length === 0) return
        }
      }

      export const config = {
        modes: {
          qa: {
            format: "wrap-prose $GTD_FILE",
          },
        },
      }
      """
    And a file "NOTES.md" with:
      """
      start
      """
    And gtd lands "gtd(human): idle → grilling"
    And I run the pin beat
    And a file ".gtd/TODO.md" with:
      """
      A plan.
      """
    And gtd lands "gtd(agent): grilling → grilling-answer"
    And ".gtd/TODO.md" is modified to:
      """
      A plan. This answer line is deliberately far longer than eighty characters so that the formatter has to rewrap it before the turn is captured.
      """
    # Package 2, Requirement A: `gtd land`'s own emitted script carries no
    # format command any more, so the long line survives the capture as-is —
    # a driver wanting it wrapped first must run `gtd validate` (or
    # `gtd next --json`'s own `validate` field) ahead of `gtd land`.
    When I run gtd with args "validate"
    Then it succeeds
    And ".gtd/TODO.md" has no lines longer than 80 characters
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): grilling-answer → grilling"
