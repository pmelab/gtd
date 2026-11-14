Feature: gtd lsp — the steering-file LSP server (stdio)

  `gtd lsp` serves the steering file the current rest names (as `gtd next
  --json` reports its `file`): an outline with one symbol per widget, a
  diagnostic for each broken widget and each unanswered required one, code
  actions to answer widgets and to add an annotation, and go-to-definition
  from a hunk pointer into its file and between an annotation's marker and
  its note. A file the rest does not name gets nothing. The handshake runs a
  spawned `gtd lsp` over stdio; the rest run the same server in-process.

  @live
  Scenario: the initialize handshake succeeds and advertises symbol/code-action support
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    And the LSP response result has a "documentSymbolProvider" capability
    And the LSP response result has a "codeActionProvider" capability

  @inmem
  Scenario: a file no rest names yields no symbols
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/TODO.md" containing:
      """
      ## 🔘 Which operations?

      - [ ] add
      """
    Then the LSP response has no error
    And the LSP response result is an empty symbol list

  @inmem
  Scenario: the rest's steering file is outlined one symbol per widget
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      # Build a calculator

      ## 🔘 Which operations?

      - [ ] add
      - [ ] subtract
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "🔘 Which operations?"
    And the LSP response result contains a symbol named "add" nested under "🔘 Which operations?"

  @inmem
  Scenario: a broken widget is a diagnostic
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      # Build a calculator

      ## ❔ Ship it?

      Yes or no.
      """
    Then the LSP client received a textDocument/publishDiagnostics notification for ".gtd/PLAN.md" with exactly one Warning diagnostic containing "needs its checkbox list"

  @inmem
  Scenario: gtd.openSteeringFile resolves the current state's steering file and asks the client to show it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client sends a workspace/executeCommand request for "gtd.openSteeringFile"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/PLAN.md"

  @inmem
  Scenario: gtd.openSteeringFile renders file: with the process's own start vars, matching what gtd next reports (issue #156)
    # A step started with `--var planFile=OTHER.md` renders its `file`
    # against THAT override, the same file `gtd next` reports.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, settings, workflow } from "@pmelab/gtd/flows"

      const defaults = { planFile: "PLAN.md" }

      export default workflow(async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: `.gtd/${settings.planFile}` })
      }, { defaults })

      export const reviewCheck = workflow(async () => {
        await human("review-check", { file: `.gtd/${settings.planFile}`, message: "reviewing" })
      }, { defaults })
      """
    And I run gtd with args "start reviewCheck --var planFile=OTHER.md"
    And I run the pin beat
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client sends a workspace/executeCommand request for "gtd.openSteeringFile"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/OTHER.md"

  @inmem
  Scenario: a definition on a hunk pointer jumps into the file, also when its path has hyphens
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("reviewing", "review it", { file: ".gtd/REVIEW.md" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → reviewing"
    And I run the pin beat
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    And the LSP response result has a "definitionProvider" capability
    When the LSP client requests a definition at line 4 in ".gtd/REVIEW.md" containing:
      """
      ## 🔍 Add budget alerts

      - [ ] ./src/calc.ts#1
      - [ ] ./src/calc.ts#5 — subtract
      - [ ] ./src/server/email/budget-threshold.ts#31
      """
    Then the LSP response has no error
    And the LSP response result points to "src/server/email/budget-threshold.ts" at line 30
    When the LSP client requests a definition at line 3 in ".gtd/REVIEW.md" containing:
      """
      ## 🔍 Add budget alerts

      - [ ] ./src/calc.ts#1
      - [ ] ./src/calc.ts#5 — subtract
      - [ ] ./src/server/email/budget-threshold.ts#31
      """
    Then the LSP response has no error
    And the LSP response result points to "src/calc.ts" at line 4

  @inmem
  Scenario: an option offers to pick it, and the editor jumps into a new annotation
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests code actions at line 3 in ".gtd/PLAN.md" containing:
      """
      ## 🔘 Which API?

      - [ ] REST
      - [ ] GraphQL
      - [ ] ✏️
      """
    Then the LSP response has no error
    And the LSP response result contains a code action titled "gtd: pick this option"
    And the LSP response result contains a code action titled "gtd: add an annotation"
    When the LSP client applies the edits of the code action titled "gtd: pick this option"
    Then the applied document contains "- [x] GraphQL"
    When the LSP client applies the edits of the code action titled "gtd: add an annotation"
    Then the applied document contains "- [ ] GraphQL[^fn1]"
    And the applied document matches "^\[\^fn1\]:$"
    When the LSP client executes the command of the code action titled "gtd: add an annotation"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/PLAN.md" with a selection at line 6 character 7, taking focus

  @inmem
  Scenario: a definition round trip jumps from an annotation's marker to its note and back
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests a definition at line 2 character 15 in ".gtd/PLAN.md" containing:
      """
      # Plan

      Add a function[^fn1] to the calculator.

      [^fn1]: Why a new one?
      """
    Then the LSP response has no error
    And the LSP response result points to ".gtd/PLAN.md" at line 4
    When the LSP client requests a definition at line 4 character 0 in ".gtd/PLAN.md" containing:
      """
      # Plan

      Add a function[^fn1] to the calculator.

      [^fn1]: Why a new one?
      """
    Then the LSP response has no error
    And the LSP response result points to ".gtd/PLAN.md" at line 2 character 14
