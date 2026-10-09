@live
Feature: gtd lsp — the steering-file LSP server (stdio)

  Minimal protocol-level smoke for `gtd lsp` (see src/Lsp.ts): the server
  starts over stdio, the
  `initialize` handshake succeeds and advertises the document-symbol/code-
  action capabilities, and a `textDocument/documentSymbol` request against a
  `.gtd/TODO.md` fixture yields NO symbols (there is no `TODO.md` → qa
  basename fallback — the bundled `idle` names that exact path as its `file:`
  but declares no `mode:`, so nothing dispatches over it). Two further
  scenarios prove the config-driven half: documentSymbol served for a
  CUSTOM-named `qa` file mapped via a real `gtd.config.ts` `file`/`mode` pair
  (once its step is reached, or up front through the workflow's `steering`
  export), and
  the `gtd.openSteeringFile` executeCommand resolving a
  hand-authored current state and asking the client to show its steering
  file (`window/showDocument`). A final scenario proves go-to-definition: a
  `textDocument/definition` on a `.gtd/REVIEW.md` hunk pointer line returns a
  `Location` in the referenced file at its `#line` (basename fallback). A
  further scenario pins the fix for a hunk pointer whose path contains
  hyphens: it must jump to the full file, not a truncated directory prefix.
  One more scenario proves a `qa`-mode code action is offered from a wrapped
  option's continuation line, not just its own `- [ ]` line (see
  `QuestionOption.endLine` in src/steering/qa.ts). Real subprocess I/O
  (spawn + stdio JSON-RPC framing), so this runs @live.

  Scenario: the initialize handshake succeeds and advertises symbol/code-action support
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    And the LSP response result has a "documentSymbolProvider" capability
    And the LSP response result has a "codeActionProvider" capability

  Scenario: with no config, .gtd/TODO.md is NOT dispatched by basename — it yields no symbols
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/TODO.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result is an empty symbol list

  Scenario: documentSymbol is served for a CUSTOM-named qa file mapped via a real .gtdrc (config-driven dispatch)
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    # The LSP knows a steering file's mode from the steps the process has
    # reached, so the process first moves on to the step that declares it.
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[unanswered] Which operations?"

  Scenario: a file the workflow's steering export declares is served before any step reaches it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export const steering = { ".gtd/PLAN.md": "qa" }

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[unanswered] Which operations?"

  Scenario: gtd.openSteeringFile resolves the current state's steering file and asks the client to show it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    And a file ".gtd/PLAN.md" with:
      """
      the plan under development
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client sends a workspace/executeCommand request for "gtd.openSteeringFile"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/PLAN.md"

  Scenario: gtd.openSteeringFile renders file: with the process's own start vars, matching what gtd next reports (issue #156)
    # Before src/Edge.ts's currentRest, the LSP's own resolveSteeringFile hand-
    # rolled a byte-for-byte copy of the CLI's resolution chain that had
    # drifted three ways: it never applied `--var` overrides, never rendered
    # `on`, and never computed a review base. This pins the fix — a step
    # started with `--var planFile=OTHER.md` renders its `file` against THAT
    # override, the same file `gtd next` would report.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, vars } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: `.gtd/${vars.planFile}`, mode: "qa" })
      }

      export const reviewCheck = async () => {
        await human("review-check", {
          file: `.gtd/${vars.planFile}`,
          mode: "qa",
          message: "reviewing",
        })
      }

      export const defaults = { planFile: "PLAN.md" }
      """
    And I run gtd with args "--workflow reviewCheck --var planFile=OTHER.md"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client sends a workspace/executeCommand request for "gtd.openSteeringFile"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/OTHER.md"

  Scenario: initialize advertises definition support and a definition on a hunk line jumps into the file
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    And the LSP response result has a "definitionProvider" capability
    When the LSP client requests a definition at line 6 in ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      - [x] ./src/calc.ts#5
        subtract
      """
    Then the LSP response has no error
    And the LSP response result points to "src/calc.ts" at line 4

  Scenario: a definition on a hunk whose path contains hyphens jumps to the file, not a parent folder
    # Regression: the pointer regex's non-greedy path group split the path at
    # its first hyphen and called the remainder a note, so the jump landed on
    # ./src/server/email/budget (a DIRECTORY) at line 0.
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests a definition at line 5 in ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add budget alerts

      - [ ] ./src/server/email/budget-threshold.ts#31
        non-obvious import
      """
    Then the LSP response has no error
    And the LSP response result points to "src/server/email/budget-threshold.ts" at line 30

  Scenario: a code action is offered on a wrapped option's continuation line, not just its checkbox line
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    # The LSP knows a steering file's mode from the steps the process has
    # reached, so the process first moves on to the step that declares it.
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests code actions at line 9 in ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which API?

      - [ ] REST
      - [ ] GraphQL
      - [ ] _your answer_
        a wrapped continuation of the free-text answer
      """
    Then the LSP response has no error
    And the LSP response result contains a code action titled "gtd: pick this option"

  Scenario: a modes: qa validate: override suppresses built-in diagnostics for a live notice, while the outline stays live
    # The registry's `qa` format identity (outline/actions) survives a declared
    # `validate:` command that displaces its built-in parser (see
    # src/SteeringMode.ts's resolveMode and its returned `capabilities` field)
    # — the editor still gets a live outline, but diagnostics become the ONE
    # Information notice pointing at `gtd validate`, never the built-in
    # findings.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          validate: "exit 1"
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    # The LSP knows a steering file's mode from the steps the process has
    # reached, so the process first moves on to the step that declares it.
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[unanswered] Which operations?"
    And the LSP client received a textDocument/publishDiagnostics notification for ".gtd/PLAN.md" with exactly one Information diagnostic containing "exit 1"

  Scenario: a modes: qa validate: entry carrying gtd's own SEEDED command keeps live diagnostics, not the external notice
    # A later package's workflow compiler will seed `qa`/`review`'s own
    # `validate:` with the literal string `gtd check <mode> "$GTD_FILE"`
    # (src/SteeringFormats.ts's seededValidateCommand) — a shell-out that just
    # calls back into gtd's own parser, changing nothing about how the file is
    # actually validated. `resolveMode`'s `capabilities` field must recognize
    # that string (isSeededValidateCommand) and keep publishing the built-in parser's live
    # findings, never the "validated by an external command" notice a genuine
    # user override gets (see the scenario above, which uses "exit 1").
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          validate: 'gtd check qa "$GTD_FILE"'
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    # The LSP knows a steering file's mode from the steps the process has
    # reached, so the process first moves on to the step that declares it.
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Plan.

      ## Open Questions

      ###

      no question text.
      """
    Then the LSP response has no error
    And the LSP client received a textDocument/publishDiagnostics notification for ".gtd/PLAN.md" with exactly one Warning diagnostic containing "has no question text"

  Scenario: 'gtd: add a footnote' inserts a marker and a seeded definition; applying the edits shows both
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests code actions at line 5 character 22 in ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1 new add function
      """
    Then the LSP response has no error
    And the LSP response result contains a code action titled "gtd: add a footnote"
    When the LSP client applies the edits of the code action titled "gtd: add a footnote"
    Then the applied document contains "[^fn1]new add function"
    And the applied document matches "^\[\^fn1\]:$"

  Scenario: gtd.revealPosition jumps the client to the end of the new footnote definition's line, independent of the edits standing on their own
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests code actions at line 5 character 22 in ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1 new add function
      """
    Then the LSP response has no error
    And the LSP response result contains a code action titled "gtd: add a footnote"
    When the LSP client applies the edits of the code action titled "gtd: add a footnote"
    Then the applied document contains "[^fn1]new add function"
    And the applied document matches "^\[\^fn1\]:$"
    When the LSP client executes the command of the code action titled "gtd: add a footnote"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/REVIEW.md" with a selection at line 6 character 7, taking focus

  Scenario: a footnote thread appears in the outline with its waiting-on detail
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1-3 new add function[^t1]

      [^t1]:
          - H: why a new function?
          - A: the old one was private
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[^t1]" with detail "waiting on you"

  Scenario: an open thread is flagged with an Information diagnostic
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1-3 new add function[^t1]

      [^t1]:
          - H: why a new function?
          - A: the old one was private
      """
    Then the LSP response has no error
    And the LSP client received a textDocument/publishDiagnostics notification for ".gtd/REVIEW.md" with exactly one Information diagnostic containing "waiting on you"

  Scenario: 'gtd: reply' appends an empty H entry and the cursor lands right after it
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests code actions at line 7 character 2 in ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1-3 new add function[^t1]

      [^t1]:
          - H: why a new function?
          - A: the old one was private
      """
    Then the LSP response has no error
    And the LSP response result contains a code action titled "gtd: reply"
    When the LSP client applies the edits of the code action titled "gtd: reply"
    Then the applied document matches "^    - H: $"
    When the LSP client executes the command of the code action titled "gtd: reply"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/REVIEW.md" with a selection at line 10 character 9, taking focus

  Scenario: a textDocument/definition round trip jumps marker to definition, then definition back to the marker's exact column
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests a definition at line 5 character 39 in ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1 new add function[^fn1]

      [^fn1]:
          the reason
      """
    Then the LSP response has no error
    And the LSP response result points to ".gtd/REVIEW.md" at line 7
    When the LSP client requests a definition at line 7 character 0 in ".gtd/REVIEW.md" containing:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add calculator

      - [ ] ./src/calc.ts#1 new add function[^fn1]

      [^fn1]:
          the reason
      """
    Then the LSP response has no error
    And the LSP response result points to ".gtd/REVIEW.md" at line 5 character 38

  Scenario: a marker in a qa file jumps to its definition — proving qa now serves pointerAt
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    # The LSP knows a steering file's mode from the steps the process has
    # reached, so the process first moves on to the step that declares it.
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests a definition at line 6 character 9 in ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      - [ ] add[^fn1]
      - [ ] subtract
      - [ ] _your answer_

      [^fn1]:
          why add is an option
      """
    Then the LSP response has no error
    And the LSP response result points to ".gtd/PLAN.md" at line 10

  Scenario: a landing that moves HEAD is reflected on the very next request, without a server restart
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result is an empty symbol list
    # Moves HEAD from OUTSIDE the running LSP session — no restart follows.
    Given a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[unanswered] Which operations?"

  Scenario: an edited gtd.config.ts takes effect on the next request, without a server restart
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export const steering = {}

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result is an empty symbol list
    # Same HEAD — an uncommitted edit to gtd.config.ts, as an editor autosave
    # would make it, with no `gtd land` in between.
    Given "gtd.config.ts" is modified to:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export const steering = { ".gtd/PLAN.md": "qa" }

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[unanswered] Which operations?"

  Scenario: an edited module that gtd.config.ts re-exports steering from takes effect on the next request — a split workflow is not stale forever
    Given a test project
    And a file "steps.ts" with:
      """
      export const steering = {}
      """
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export { steering } from "./steps.js"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result is an empty symbol list
    # Same HEAD, "gtd.config.ts" ITSELF untouched — only the sibling module it
    # imports `steering` from changes, as an editor autosave would make it.
    Given "steps.ts" is modified to:
      """
      export const steering = { ".gtd/PLAN.md": "qa" }
      """
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[unanswered] Which operations?"
    # A SECOND edit to the now-already-known "steps.ts" — the one a stat-
    # after-read memo can pin wrong on the FIRST edit and never budge again.
    Given "steps.ts" is modified to:
      """
      export const steering = {}
      """
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result is an empty symbol list

  Scenario: an edited .gtdrc registering a previously-unknown mode takes effect on the next request, without a server restart
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export const steering = { ".gtd/NOTES.md": "annotated", ".gtd/MORE.md": "annotated" }

      export default async () => {
        await human("idle", { message: "go" })
      }
      """
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/NOTES.md" containing:
      """
      some notes
      """
    Then the LSP response has no error
    # "annotated" isn't registered anywhere yet — no notice is published for
    # ".gtd/NOTES.md". Same HEAD — an uncommitted .gtdrc, as an editor
    # autosave would make it, registers it for the memo's NEXT request.
    Given a file ".gtdrc.yaml" with:
      """
      modes:
        annotated:
          validate: "exit 1"
      """
    When the LSP client requests document symbols for ".gtd/MORE.md" containing:
      """
      some more notes
      """
    Then the LSP response has no error
    And the LSP client received a textDocument/publishDiagnostics notification for ".gtd/MORE.md" with exactly one Information diagnostic containing "exit 1"

  Scenario: a thread in a qa document is a symbol nested under its question, waiting on you
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which API?[^t1]

      - [ ] REST
      - [ ] GraphQL
      - [ ] _your answer_

      [^t1]:
          - H: why GraphQL?
          - A: it is typed
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[^t1]" nested under "Which API?"
    And the LSP response result contains a symbol named "[^t1]" with detail "waiting on you"

  Scenario: 'gtd: reply' on a qa thread's definition inserts an empty H entry and reveals right after it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests code actions at line 10 character 2 in ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which API?[^t1]

      - [ ] REST
      - [ ] GraphQL
      - [ ] _your answer_

      [^t1]:
          - H: why GraphQL?
          - A: it is typed
      """
    Then the LSP response has no error
    And the LSP response result contains a code action titled "gtd: reply"
    When the LSP client applies the edits of the code action titled "gtd: reply"
    Then the applied document matches "^    - H: $"
    When the LSP client executes the command of the code action titled "gtd: reply"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/PLAN.md" with a selection at line 13 character 9, taking focus

  Scenario: 'gtd: reply' is not offered on a qa thread waiting on the agent
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "develop the plan", { file: ".gtd/PLAN.md", mode: "qa" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests code actions at line 10 character 2 in ".gtd/PLAN.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which API?[^t1]

      - [ ] REST
      - [ ] GraphQL
      - [ ] _your answer_

      [^t1]:
          - H: why GraphQL?
      """
    Then the LSP response has no error
    And the LSP response result contains no code action titled "gtd: reply"
