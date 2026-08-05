@live
Feature: gtd lsp — the steering-file LSP server (stdio)

  Minimal protocol-level smoke for `gtd lsp` (see src/Lsp.ts and
  docs/design/steering-file-loops.md §5): the server starts over stdio, the
  `initialize` handshake succeeds and advertises the document-symbol/code-
  action capabilities, and a `textDocument/documentSymbol` request against an
  unmapped `.gtd/TODO.md` fixture yields NO symbols (the `TODO.md` → qa basename
  fallback was removed — TODO.md is now a free-form plan file). Two further
  scenarios prove the config-driven half (see
  docs/design/state-file-association.md §3): documentSymbol served for a
  CUSTOM-named `qa` file mapped via a real `.gtdrc` `file:`/`mode:` pair, and
  the `gtd.openSteeringFile` executeCommand resolving a
  hand-authored current state and asking the client to show its steering
  file (`window/showDocument`). A final scenario proves go-to-definition: a
  `textDocument/definition` on a `.gtd/REVIEW.md` hunk pointer line returns a
  `Location` in the referenced file at its `#line` (basename fallback). Real
  subprocess I/O (spawn + stdio JSON-RPC framing), so this runs @live.

  Scenario: the initialize handshake succeeds and advertises symbol/code-action support
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    And the LSP response result has a "documentSymbolProvider" capability
    And the LSP response result has a "codeActionProvider" capability

  Scenario: with no config, .gtd/TODO.md is NOT dispatched by basename — it yields no symbols
    # The `TODO.md` → qa basename fallback was removed: the bundled template's
    # simple flow iterates on a free-form plan there, not a qa-format file. With
    # no `.gtdrc` mapping it, documentSymbol returns nothing. (Config-driven qa
    # dispatch over any file — including TODO.md — is covered below.)
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
                file: ".gtd/PLAN.md"
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
                file: ".gtd/PLAN.md"
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
      - [x] ./src/calc.ts#5 — subtract
      """
    Then the LSP response has no error
    And the LSP response result points to "src/calc.ts" at line 4
