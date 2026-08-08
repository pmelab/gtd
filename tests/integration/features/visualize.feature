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
    And stdout contains "entryGate"
    And stdout contains "healthGate"
    And stdout contains "packageLoop"
    And stdout contains "packageItem"

  Scenario: --json labels an identity-bearing group with its machine's model
    # `build` (simpleBuild) and `packages.item` (packageItem) each declare a
    # machine-level `model:` (▸ coder) — every one of a group's own prompt
    # states is stamped with that SAME value (src/Machines.ts's
    # `resolveInstanceModel`), so `VizGroup.model` (package 04) surfaces it
    # once per group instead of once per state.
    Given a test project
    When I run gtd with args "visualize --json"
    Then it succeeds
    And stdout matches "\"name\": \"build\",[^}]*\"model\": \"<%= it\.vars\.coderModel %>\""
    And stdout matches "\"name\": \"packages\.item\",[^}]*\"model\": \"<%= it\.vars\.coderModel %>\""

  Scenario: --json omits the model entirely for an identity-free gate/queue group
    # `plan-gate` (entryGate) and `packages` (packageLoop) declare no
    # machine-level `model:` — they are infrastructure, not a persona — so
    # their groups carry no `model` key at all (never a blank/null one).
    Given a test project
    When I run gtd with args "visualize --json"
    Then it succeeds
    And stdout matches "\"name\": \"plan-gate\",\s*\"machine\": \"entryGate\",\s*\"states\": \[[^\]]*\],\s*\"depth\": 0\s*\}"
    And stdout matches "\"name\": \"packages\",\s*\"machine\": \"packageLoop\",\s*\"states\": \[[^\]]*\],\s*\"depth\": 0\s*\}"

  Scenario: an unknown option is rejected (no server is started)
    Given a test project
    When I run gtd with args "visualize --bogus"
    Then it fails
    And stderr contains "unknown option"

  Scenario: an unexpected positional argument is rejected
    Given a test project
    When I run gtd with args "visualize bogus"
    Then it fails
    And stderr contains "too many arguments"

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
    # never exploding it into `packages.item` (and that instance's own
    # `.health`/`.spec` children) at that scope.
    And stdout matches "\"name\": \"packages\",\s*\"machine\": \"packageLoop\",\s*\"states\": \[[^\]]*\],\s*\"depth\": 0"

  Scenario: --json's groups expose that same nested machine's own descendants as separate deeper entries
    Given a test project
    When I run gtd with args "visualize --json"
    Then it succeeds
    # Scoped INTO `packages`, its own child (`packages.item`, a packageItem
    # instance) is a separate group entry one level deeper, naming `packages`
    # as `parent` — the front end renders THESE as their own boxes/nodes when
    # the diagram's scope is `packages` itself, rather than collapsing the
    # whole subtree again. Its own children (`packages.item.health`/
    # `packages.item.spec`) sit one level deeper again, at depth 2.
    And stdout matches "\"name\": \"packages\.item\",\s*\"machine\": \"packageItem\",\s*\"states\": \[[^\]]*\],\s*\"parent\": \"packages\",\s*\"depth\": 1"
    And stdout matches "\"name\": \"packages\.item\.health\",\s*\"machine\": \"healthGate\",\s*\"states\": \[[^\]]*\],\s*\"parent\": \"packages\.item\",\s*\"depth\": 2"
    And stdout matches "\"name\": \"packages\.item\.spec\",\s*\"machine\": \"specReview\",\s*\"states\": \[[^\]]*\],\s*\"parent\": \"packages\.item\",\s*\"depth\": 2"

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
                message: "write NOTE.md to start a process"
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
