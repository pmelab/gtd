@live
Feature: gtd lsp — the steering-file LSP server (stdio)

  Minimal protocol-level smoke for `gtd lsp` (see src/Lsp.ts and
  docs/design/steering-file-loops.md §5): the server starts over stdio, the
  `initialize` handshake succeeds and advertises the document-symbol/code-
  action capabilities, and a `textDocument/documentSymbol` request against a
  `.gtd/TODO.md` fixture yields NO symbols (there is no `TODO.md` → qa
  basename fallback — the bundled `idle` names that exact path as its `file:`
  but declares no `mode:`, so nothing dispatches over it). Two further
  scenarios prove the config-driven half (see
  docs/design/state-file-association.md §3): documentSymbol served for a
  CUSTOM-named `qa` file mapped via a real `.gtdrc` `file:`/`mode:` pair, and
  the `gtd.openSteeringFile` executeCommand resolving a
  hand-authored current state and asking the client to show its steering
  file (`window/showDocument`). A final scenario proves go-to-definition: a
  `textDocument/definition` on a `.gtd/REVIEW.md` hunk pointer line returns a
  `Location` in the referenced file at its `#line` (basename fallback). A
  further scenario pins the fix for a hunk pointer whose path contains
  hyphens: it must jump to the full file, not a truncated directory prefix.
  One more scenario proves a `qa`-mode code action is offered from a wrapped
  option's continuation line, not just its own `- [ ]` line (see
  `QuestionOption.endLine` in src/OpenQuestions.ts). Real subprocess I/O
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                file: "PLAN.md"
                mode: qa
                prompt: "develop the plan"
                on:
                  "* **": idle
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                file: "PLAN.md"
                mode: qa
                prompt: "develop the plan"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds ".gtd/PLAN.md" with:
      """
      the plan under development
      """
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client sends a workspace/executeCommand request for "gtd.openSteeringFile"
    Then the LSP response has no error
    And the LSP client received a window/showDocument request for ".gtd/PLAN.md"

  Scenario: gtd.openSteeringFile renders file: with the process's own entry vars, matching what gtd next reports (issue #156)
    # Before src/Edge.ts's currentRest, the LSP's own resolveSteeringFile hand-
    # rolled a byte-for-byte copy of the CLI's resolution chain that had
    # drifted three ways: it never applied `--var` overrides, never rendered
    # `on`, and never computed a review base. This pins the fix — a state
    # entered with `--var planFile=OTHER.md` renders `file:` against THAT
    # override, the same file `gtd next` would report.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        vars:
          planFile: PLAN.md
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                file: "<%= it.vars.planFile %>"
                mode: qa
                prompt: "develop the plan"
                on:
                  "* **": idle
              review-check:
                entry: true
                actor: human
                file: "<%= it.vars.planFile %>"
                mode: qa
                message: "reviewing"
                on:
                  "* **": idle
      """
    And I run gtd with args "--entry review-check --var planFile=OTHER.md"
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                file: "PLAN.md"
                mode: qa
                prompt: "develop the plan"
                on:
                  "* **": idle
      """
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
    # src/SteeringMode.ts's resolveSteeringMode / steeringCapabilities) — the
    # editor still gets a live outline, but diagnostics become the ONE
    # Information notice pointing at `gtd validate`, never the built-in
    # findings.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          qa:
            validate: "exit 1"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                file: "PLAN.md"
                mode: qa
                prompt: "develop the plan"
                on:
                  "* **": idle
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
    And the LSP client received a textDocument/publishDiagnostics notification for ".gtd/PLAN.md" with exactly one Information diagnostic containing "exit 1"

  Scenario: a modes: qa validate: entry carrying gtd's own SEEDED command keeps live diagnostics, not the external notice
    # A later package's workflow compiler will seed `qa`/`review`'s own
    # `validate:` with the literal string `gtd check <mode> '<%= it.file %>'`
    # (src/SteeringFormats.ts's seededValidateCommand) — a shell-out that just
    # calls back into gtd's own parser, changing nothing about how the file is
    # actually validated. steeringCapabilities must recognize that string
    # (isSeededValidateCommand) and keep publishing the built-in parser's live
    # findings, never the "validated by an external command" notice a genuine
    # user override gets (see the scenario above, which uses "exit 1").
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          qa:
            validate: "gtd check qa '<%= it.file %>'"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                file: "PLAN.md"
                mode: qa
                prompt: "develop the plan"
                on:
                  "* **": idle
      """
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
