Feature: gtd ui's process lifecycle — one worktree, one step, one exit

  Package 02 inverts `gtd ui`'s own control flow: handoff (the phone's "Done"
  action) EXITS the process instead of spawning a configured loop command —
  there is no more `ui.loop`, no shim `$PATH`, no SIGINT-then-SIGKILL child
  management. `ui.feature`'s own `@inmem` scenarios only cover `gtd ui`'s
  fast, deterministic refusal paths reachable with no real filesystem beneath
  them; a successful bind and the handoff round trip both need a REAL worktree
  (`gtd ui` reads its own beat via a real `gtd next --json` subprocess spawn
  BEFORE it ever resolves a bind host or a certificate — see
  `src/ui/Server.ts#runUiCommand`), so every scenario here that actually binds
  is `@live`, spawning a real OS process exactly like
  `spawnGtdUiAndSignal`/`spawnGtdUiAndHandOff` (`tests/integration/support/world.ts`)
  already did for the SIGINT/SIGTERM cases.

  @live
  Scenario: gtd ui binds for real and exits 130 on SIGINT — the same signal Ctrl-C sends
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
                message: "write NOTE.md to start"
                on:
                  "* **": working
              working:
                actor: human
                file: "PLAN.md"
                mode: qa
                prompt: "answer the plan"
                on:
                  "* **": idle
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file "PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    When I send SIGINT to a spawned gtd ui
    Then the reported exit status is 130

  @live
  Scenario: gtd ui binds for real and exits 143 on SIGTERM
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
                message: "write NOTE.md to start"
                on:
                  "* **": working
              working:
                actor: human
                file: "PLAN.md"
                mode: qa
                prompt: "answer the plan"
                on:
                  "* **": idle
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file "PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    When I send SIGTERM to a spawned gtd ui
    Then the reported exit status is 143

  @live
  Scenario: handing off exits 0, with the human's note durably on disk and no child process spawned
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
                message: "write NOTE.md to start"
                on:
                  "* **": working
              working:
                actor: human
                file: "PLAN.md"
                mode: qa
                prompt: "answer the plan"
                on:
                  "* **": idle
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file "PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    # `spawnGtdUiAndHandOff` drives a REAL `done` mutation over a REAL HTTPS
    # tRPC round trip against a REAL spawned `gtd ui`, then waits for the
    # process to exit ON ITS OWN — never signalled — proving `ctx.handOff()`
    # actually terminates the server once the response has flushed. No
    # `ui.loop`/child process exists anywhere in this design to spawn.
    When I hand off "PLAN.md" in mode "qa" with the text "handed back" to a spawned gtd ui
    Then the reported exit status is 0
    And the file "PLAN.md" contains "handed back"

  @live
  Scenario: closing the UI without handing off never writes a note — and, absent handoff, only a signal ever ends the process
    # T1's own prose warns that "a human who closes the tab without handing
    # off produces the same exit 0 as a handoff" — but package 02's actual
    # task list (Router.ts's procedure set: step/writeNote/done/view/diff/
    # readSteeringFile) names no distinct "close" procedure separate from
    # `done`, and Server.ts's only two ways to stop are `ctx.handOff()`
    # (exit 0, exercised above) and a process signal (130/143, per
    # docs/cli.md's own pinned exit-code table). This scenario proves the
    # "closes without handing off" HALF of that claim — no note is ever
    # written — through the one mechanism this package actually built for a
    # human to walk away: SIGTERM, same as the scenario above, deliberately
    # NOT re-asserting exit 0 (which no code path in this package produces
    # for a bare close) in favour of the exit code `docs/cli.md` actually
    # pins for a signalled death.
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
                message: "write NOTE.md to start"
                on:
                  "* **": working
              working:
                actor: human
                file: "PLAN.md"
                mode: qa
                prompt: "answer the plan"
                on:
                  "* **": idle
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file "PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    When I send SIGTERM to a spawned gtd ui
    Then the reported exit status is 143
    And the file "PLAN.md" does not contain "handed back"

  @inmem
  Scenario: a config file with ui.loop fails to decode
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      ui:
        loop: "claude -p"
      """
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "loop"
