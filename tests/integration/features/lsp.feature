@live
Feature: gtd lsp — the steering-file LSP server (stdio)

  Minimal protocol-level smoke for `gtd lsp` (see src/Lsp.ts and
  docs/design/steering-file-loops.md §5): the server starts over stdio, the
  `initialize` handshake succeeds and advertises the document-symbol/code-
  action capabilities, and a `textDocument/documentSymbol` request against a
  `.gtd/TODO.md` fixture round-trips the open-questions parser's output.
  Real subprocess I/O (spawn + stdio JSON-RPC framing), so this runs @live.

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
