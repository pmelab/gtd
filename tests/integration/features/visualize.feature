@inmem
Feature: gtd visualize — an interactive diagram of the active workflow

  `gtd visualize` serves a local web page rendering the active workflow (the
  main flow, its sub-machines, and per-state details — see src/Visualize.ts).
  `--json` prints the underlying model and exits WITHOUT starting a server, so
  the model builder is testable without a socket. The command reads the config
  but touches no git/HEAD/review-window, and owns its own `--port`/`--no-open`
  options.

  Scenario: --json prints the active workflow model and authors nothing
    Given a test project
    And I record the commit count
    When I run gtd with args "visualize --json"
    Then it succeeds
    And stdout contains "initial"
    And stdout contains "groups"
    And stdout contains "incoming"
    And the commit count is unchanged

  Scenario: --json surfaces the built-in default's sub-machine groups
    Given a test project
    When I run gtd with args "visualize --json"
    Then it succeeds
    And stdout contains "assertGreen"
    And stdout contains "makeGreen"
    And stdout contains "packageLoop"

  Scenario: an unknown option is rejected (no server is started)
    Given a test project
    When I run gtd with args "visualize --bogus"
    Then it fails
    And stderr contains "unknown option"

  Scenario: an unexpected positional argument is rejected
    Given a test project
    When I run gtd with args "visualize bogus"
    Then it fails
    And stderr contains "unexpected argument"

  Scenario: an invalid --port is rejected
    Given a test project
    When I run gtd with args "visualize --port abc"
    Then it fails
    And stderr contains "--port must be an integer"

  Scenario: --json's groups collapse a nested machine to a single depth-0 entry from the parent scope
    Given a test project
    When I run gtd with args "visualize --json"
    Then it succeeds
    # The `packages` instance (packageLoop) is its own top-level group with no
    # `parent` and depth 0 — the front end's `unitOf` collapses everything
    # under it to ONE box when rendering the top-level (unified) diagram,
    # never exploding it into `packages.health`/`packages.spec` at that scope.
    And stdout matches "\"name\": \"packages\",\s*\"machine\": \"packageLoop\",\s*\"states\": \[[^\]]*\],\s*\"depth\": 0"

  Scenario: --json's groups expose that same nested machine's own children as separate depth-1 entries
    Given a test project
    When I run gtd with args "visualize --json"
    Then it succeeds
    # Scoped INTO `packages`, its own children (`packages.health`/
    # `packages.spec`) are separate group entries one level deeper, each
    # naming `packages` as `parent` — the front end renders THESE as their own
    # boxes/nodes when the diagram's scope is `packages` itself, rather than
    # collapsing the whole subtree again.
    And stdout matches "\"name\": \"packages\.health\",\s*\"machine\": \"makeGreen\",\s*\"states\": \[[^\]]*\],\s*\"parent\": \"packages\",\s*\"depth\": 1"
    And stdout matches "\"name\": \"packages\.spec\",\s*\"machine\": \"specReview\",\s*\"states\": \[[^\]]*\],\s*\"parent\": \"packages\",\s*\"depth\": 1"

  Scenario: --json labels an edge by its declared action, falling back to the raw pattern when none is declared
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
                message: "write NOTE.md to start a cycle"
                on:
                  "* **":
                    to: reviewing
                    action: "Accept the plan"
              reviewing:
                actor: agent
                prompt: "review NOTE.md"
                on:
                  "A FEEDBACK.md": idle
      """
    When I run gtd with args "visualize --json"
    Then it succeeds
    And stdout contains "Accept the plan"
    And stdout contains "A FEEDBACK.md"
