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
    # The workflow's own `file: "PLAN.md"` is RELATIVE to ".gtd/" — the
    # compiler prepends that directory (`StateFields.ts`'s own doc comment),
    # so the steering file the served step actually names, and the one a
    # real phone client's `readSteeringFile`/`writeNote` calls would use, is
    # ".gtd/PLAN.md" — never bare "PLAN.md" at the repo root.
    And a file ".gtd/PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    # `spawnGtdUiAndHandOff` drives a REAL `done` mutation over a REAL HTTPS
    # tRPC round trip against a REAL spawned `gtd ui`, then waits for the
    # process to exit ON ITS OWN — never signalled — proving `ctx.handOff()`
    # actually terminates the server once the response has flushed. No
    # `ui.loop`/child process exists anywhere in this design to spawn.
    When I hand off ".gtd/PLAN.md" in mode "qa" with the text "handed back" to a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/PLAN.md" contains "handed back"

  @live
  Scenario: picking a question option writes the tick through to disk over a real setValue round trip
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
    # See the handoff scenario above: the workflow's `file: "PLAN.md"` is
    # relative to ".gtd/", so the served steering file is ".gtd/PLAN.md".
    And a file ".gtd/PLAN.md" with:
      """
      Sample plan.

      ## Open Questions

      ### Which option?

      - [ ] Option A
      - [ ] Option B
      """
    # `spawnGtdUiAndSetValue` drives a REAL `setValue` mutation over a REAL
    # HTTPS tRPC round trip against a REAL spawned `gtd ui`, splicing through
    # `SteeringFormat.apply` server-side — the same checkbox write path the
    # phone client's `Question.tsx` uses when a human picks an option, never
    # a note/`annotate`/`done` round trip. Unlike a handoff, `setValue` never
    # ends the turn, so the process is torn down explicitly afterward.
    When I pick option 0 of question 0 in ".gtd/PLAN.md" mode "qa" via a spawned gtd ui
    Then the file ".gtd/PLAN.md" contains "[x] Option A"

  @live
  Scenario: closing the UI without handing off exits 0 and writes no note
    # `main.tsx`'s own `pagehide` listener fires a `sendBeacon` POST to
    # `/close` — `Server.ts`'s plain (non-tRPC) handler for it resolves the
    # SAME deferred `handOff` does, with no write ever attempted, so the
    # process exits 0 exactly like a real handoff, just with nothing landed.
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
    When I close a spawned gtd ui without handing off
    Then the reported exit status is 0
    And the file "PLAN.md" does not contain "handed back"

  @inmem
  Scenario: a config file with ui.loop fails to decode
    # Exit 1, not 2: `ConfigSchema.ts`'s own doc comment on `UiSchema` records
    # the deliberate deviation — every OTHER `.gtdrc` decode failure in this
    # codebase exits 1 (`EXIT_RUNTIME_ERROR`, via `Config.ts#formatSchemaError`),
    # and a `ui:`-only exception to `EXIT_USAGE_ERROR` would be the one config
    # error in the whole CLI a user couldn't infer the reason for.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      ui:
        loop: "claude -p"
      """
    When I run gtd with args "ui"
    Then it fails
    And the exit code is 1
    And stderr contains "loop"
