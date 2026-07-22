@live
Feature: gtd lsp — the steering-file LSP server (stdio)

  Minimal protocol-level smoke for `gtd lsp` (see src/Lsp.ts and
  docs/design/steering-file-loops.md §5): the server starts over stdio, the
  `initialize` handshake succeeds and advertises the document-symbol/code-
  action capabilities, and a `textDocument/documentSymbol` request against a
  `.gtd/TODO.md` fixture round-trips the open-questions parser's output (the
  no-config basename fallback). Two further scenarios prove the config-driven
  half (see docs/design/state-file-association.md §3): documentSymbol served
  for a CUSTOM-named `qa` file mapped via a real `.gtdrc` `file:`/`mode:`
  pair, and the `gtd.openSteeringFile` executeCommand resolving a
  hand-authored current state and asking the client to show its steering
  file (`window/showDocument`). Real subprocess I/O (spawn + stdio JSON-RPC
  framing), so this runs @live.

  Scenario: the initialize handshake succeeds and advertises symbol/code-action support
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    And the LSP response result has a "documentSymbolProvider" capability
    And the LSP response result has a "codeActionProvider" capability

  Scenario: a documentSymbol request against a TODO.md fixture round-trips the open-questions parser
    Given a test project
    And an LSP server started in the test project
    When the LSP client sends an initialize request
    Then the LSP response has no error
    When the LSP client requests document symbols for ".gtd/TODO.md" containing:
      """
      Build a calculator.

      ## Open Questions

      ### Which operations?

      Suggested default: add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[suggested] Which operations?"

  Scenario: documentSymbol is served for a CUSTOM-named qa file mapped via a real .gtdrc (config-driven dispatch)
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
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

      Suggested default: add and subtract.
      """
    Then the LSP response has no error
    And the LSP response result contains a symbol named "[suggested] Which operations?"

  Scenario: gtd.openSteeringFile resolves the current state's steering file and asks the client to show it
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
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
