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

  # Package 01's Task 4: the two scenarios above spawn over `--host 127.0.0.1
  # --self-signed`, which takes Task 3 step 1 and skips `tailscale serve`
  # entirely — asserting no mapping/record survives THAT spawn would pass
  # vacuously, since neither was ever created. The two scenarios below spawn
  # over the SERVE path instead (`spawnGtdUiServeAndSignal`, no
  # --host/--self-signed) for that specific proof — Task 4's own flagged
  # claim that `runMain` interrupting the fiber on a REAL OS signal actually
  # runs the `Effect.ensuring` finalizer that unpublishes, not just on
  # `Fiber.interrupt` in a unit test (`Server.test.ts`).

  @live
  Scenario: gtd ui binds for real over tailscale serve and exits 130 on SIGINT, tearing down its mapping
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
    When I send SIGINT to a spawned gtd ui using tailscale serve on port 18445
    Then the reported exit status is 130
    And no tailscale serve mapping or ownership record survives on port 18445

  @live
  Scenario: gtd ui binds for real over tailscale serve and exits 143 on SIGTERM, tearing down its mapping
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
    When I send SIGTERM to a spawned gtd ui using tailscale serve on port 18446
    Then the reported exit status is 143
    And no tailscale serve mapping or ownership record survives on port 18446

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
  Scenario: handing off with no note (package 04's Done control) exits the same way the note-carrying handoff does
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
    And a file ".gtd/PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    # `spawnGtdUiAndHandOffNoNote` drives a REAL `done` mutation with no
    # `note` at all over a REAL HTTPS tRPC round trip against a REAL spawned
    # `gtd ui`, then waits for the process to exit ON ITS OWN — the exact
    # same handoff the note-carrying scenario above exercises, minus the
    # write there's nothing to leave behind for.
    When I hand off with no note to a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/PLAN.md" contains "Paragraph zero here."

  @live
  Scenario: no --host given, gtd ui publishes through tailscale serve and tears the mapping down on handoff
    # Package 01's serve-first front door: no --host/--self-signed given, so
    # `runUiCommand` probes and publishes through `tailscale serve` instead of
    # binding the tailnet IP directly. Neither a real tailnet nor even the
    # `tailscale` binary is guaranteed on a CI runner, so this drives a fake
    # `tailscale` CLI (`hooks.ts`'s `FAKE_TAILSCALE_SCRIPT`, installed on
    # every @live scenario's `$PATH` shim) that speaks the real command
    # shapes `src/ui/Serve.ts` issues. `spawnGtdUiServeAndHandOff` reads the
    # real ownership record `attemptServe` writes to
    # `~/.gtd/serve/<port>.json` to dial the loopback target directly (the
    # fake hostname resolves nowhere real) — proving both the publish AND
    # the teardown side of Task 4's ownership guarantee.
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
    And a file ".gtd/PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    When I hand off ".gtd/PLAN.md" in mode "qa" with the text "handed back" to a spawned gtd ui using tailscale serve on port 18443
    Then the reported exit status is 0
    And the file ".gtd/PLAN.md" contains "handed back"
    And no tailscale serve mapping or ownership record survives on port 18443

  @live
  Scenario: no --host given, tailscale serve's publish fails, gtd ui falls back to a reachable direct bind and still exits 0 on handoff
    # Task 3's own "never refuses" guarantee (bullet 3): the serve ATTEMPT
    # still runs first (no --host/--self-signed — giving either would skip
    # the attempt entirely, defeating the point), but the fake `tailscale
    # serve --bg` is armed to fail, so `runUiCommand` falls back to today's
    # direct bind instead. `ui.cert`/`ui.key` name a REAL cert/key pair (the
    # fake tailscale CLI has no `cert` subcommand, so the tailscale-cert
    # branch `resolveCertPair` would otherwise take fails outright rather
    # than falling back) — the fallback's own host resolution still needs a
    # real Tailscale CGNAT interface on the machine running this scenario,
    # the same as `resolveBindHost`'s production behavior with neither
    # --host nor ui.host given. On CI that address is a loopback alias the
    # workflow adds (.github/workflows/test.yml), not a joined tailnet.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      ui:
        cert: cert.pem
        key: key.pem
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
    And a self-signed TLS cert and key at "cert.pem" and "key.pem"
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file ".gtd/PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    And the fake tailscale CLI's next serve publish fails
    When I hand off ".gtd/PLAN.md" in mode "qa" with the text "handed back" to a spawned gtd ui using tailscale serve on port 18447, falling back after the failed publish
    Then the reported exit status is 0
    And the file ".gtd/PLAN.md" contains "handed back"

  # Package 01 Task 6: no --port given at all, so `resolveListener`'s own
  # candidate walk (8443 → 10000 → 443) is what picks the port — unlike
  # every scenario above, which pins an explicit `--port` and so only ever
  # exercises the one-element-list branch. 8443 is seeded as a foreign
  # mapping first, so the walk must land on 10000.
  @live
  Scenario: no --port given, 8443 already carries a foreign mapping, gtd ui's own candidate walk lands on 10000 and tears only that down
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
    And a file ".gtd/PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    And a foreign tailscale serve mapping already published on port 8443
    When I hand off ".gtd/PLAN.md" in mode "qa" with the text "handed back" to a spawned gtd ui using tailscale serve on the default port
    Then the reported exit status is 0
    And the file ".gtd/PLAN.md" contains "handed back"
    And the taken serve port is 10000
    And no tailscale serve mapping or ownership record survives on port 10000
    And the foreign tailscale serve mapping on port 8443 is untouched

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
  Scenario: a page reload does not kill gtd ui — it survives and still hands off through done
    # No `pagehide` beacon exists any more (package 03 Task 8) to mistake a
    # reload for a close — a real GET against the served origin (the exact
    # request a pull-to-refresh reissues) must still be served, and the
    # process must still end through a real `done` handoff afterward, exit 0.
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
    And a file ".gtd/PLAN.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    When I reload the client of a spawned gtd ui, then hand off ".gtd/PLAN.md" in mode "qa" with the text "handed back"
    Then the reported exit status is 0
    And the file ".gtd/PLAN.md" contains "handed back"

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
