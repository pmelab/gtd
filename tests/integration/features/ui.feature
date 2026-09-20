Feature: gtd ui — the phone/web client's HTTPS listener

  `gtd ui` binds a long-lived HTTPS server exposing the phone/web client for
  THIS worktree — the invoking directory, there is no fleet and no configured
  list of roots to discover one from. Unlike `gtd visualize`, `needs: "state"`:
  it shares the repo-root and at-least-one-commit guard with every other
  state command. Before ever resolving a bind host or a certificate, it reads
  the served worktree's own beat (a real `gtd next --json` subprocess spawn)
  and refuses — exit 2, no port ever bound — unless that beat rests with a
  HUMAN actor carrying a `file`: every other rest has no phone screen to show
  it on, regardless of its reported content kind. Idle is renderable too —
  the phone opens free-form on the idle rest's own `file` (`.gtd/TODO.md` in
  the bundled workflow), and the human's write is what eventually moves the
  state, not `gtd ui` itself. `mode` is NOT part of that axis — an absent or
  unregistered mode renders free-form. That beat read needs a REAL
  worktree underneath it, so every scenario below that gets past it (or
  specifically proves a NON-renderable rest) is `@live`; only the two fast,
  purely config/guard-level refusals stay `@inmem`.

  @inmem
  Scenario: a repository with no commits refuses through the shared repo guard, not gtd ui's own refusal — inverted from when gtd serve skipped this guard entirely
    Given a git repository with no commits
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "gtd requires a repository with at least one commit"

  @live
  Scenario: gtd ui outside a git repository refuses through the repo-root guard
    Given a plain directory that is not a git repository
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "not a git repository"

  # ── Refusing to start on a step the UI cannot render (T1) — every case here
  # uses --self-signed --host so ONLY the render gate is under test, never the
  # host/cert resolution the scenarios further down exist to cover. ──────────

  @live
  Scenario: gtd ui binds on an idle worktree (the default rest of a fresh project), the phone sketches, hands off, and the sketch stays un-triaged until the next gtd run
    Given a test project
    And I record the commit count
    When I sketch ".gtd/TODO.md" with the text "a sketch from the phone" then hand off via a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/TODO.md" contains "a sketch from the phone"
    And the git status contains ".gtd/TODO.md"
    And the commit count is unchanged

  @live
  Scenario: a clean message rest (non-idle), resting with a human but with no steering file, refuses on the actor axis
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
                  "* **": done
              done:
                actor: human
                message: "all done"
      """
    And a commit "gtd(human): done" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "rests with you"

  @live
  Scenario: a dirty rest (kind capture), resting with a human but with no steering file, refuses on the steering-file axis — the content kind is never the axis
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
                  "* **": done
              done:
                actor: human
                message: "all done"
      """
    And a commit "gtd(human): done" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "scratch.txt" with:
      """
      uncommitted content — dirties the tree, turning the rest into a capture
      """
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "rests with you"

  @live
  Scenario: a script rest, resting with the check actor, refuses on the actor axis
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
                actor: agent
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": checking
              checking:
                actor: check
                script: "echo hi"
                on:
                  "C": idle
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file "RESULT.md" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "check"

  @live
  Scenario: a stalled rest (a clean-tree agent attempt at a prompt state), resting with the agent actor, refuses on the actor axis
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
                actor: agent
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And an empty commit "gtd(agent): working"
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "agent"


  @live
  Scenario: a prompt rest resting with a human, whose mode resolves to no registered steering format, binds a port instead of refusing
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          custom-mode:
            validate: "true"
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
                mode: custom-mode
                prompt: "answer the plan"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file ".gtd/PLAN.md" with:
      """
      Paragraph zero here.
      """
    When I hand off ".gtd/PLAN.md" in mode "custom-mode" with the text "handed back" to a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/PLAN.md" contains "handed back"

  # ── The positive scenario that fails today (T7): a human rest carrying a
  # `file` and a registered `mode`, reporting kind `message` (not `prompt`) —
  # the exact shape of `build.review.await-review` — binds a port and exits
  # 0. The pre-existing render gate (kind === "prompt") refuses this with
  # exit 2; only the actor-based gate this package installs admits it.
  # Proven via the same real spawn-and-handoff round trip
  # `ui-lifecycle.feature` already uses (`world.ts#spawnGtdUiAndHandOff`) —
  # bind, then a real HTTPS tRPC `done` call, then the process exits 0 on
  # its own. ─────────────────────────────────────────────────────────────

  @live
  Scenario: a human rest reporting kind message, carrying a file and a registered mode, binds a port and exits 0
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
                  "* **": awaiting-review
              awaiting-review:
                actor: human
                file: "REVIEW.md"
                mode: qa
                message: "awaiting your review"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    # The workflow's own `file: "REVIEW.md"` is RELATIVE to ".gtd/" — the
    # compiler prepends that directory (`StateFields.ts`'s own doc comment),
    # so the served steering file is ".gtd/REVIEW.md", never bare
    # "REVIEW.md" at the repo root.
    And a file ".gtd/REVIEW.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    When I hand off ".gtd/REVIEW.md" in mode "qa" with the text "handed back" to a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/REVIEW.md" contains "handed back"

  # ── Package 01 Task 10 — a genuinely mode-less rest (no `mode:` key at all
  # on the state, distinct from the unregistered-`custom-mode` scenario
  # above): renders its own structure, accepts a block edit, refuses a stale
  # write, hands off, and formats on write — the free-form screen's own
  # end-to-end acceptance. Every scenario below shares the same workflow
  # shape: `idle` (write NOTE.md to start) → `planning`, a human rest
  # carrying `file: "TODO.md"` and no `mode:` at all. ─────────────────────

  @live
  Scenario: a mode-less steering file renders as its own structure — headings, a list, and a fenced code block
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
                  "* **": planning
              planning:
                actor: human
                file: "TODO.md"
                message: "edit the plan"
      """
    And a commit "gtd(human): planning" that adds "NOTE.md" with:
      """
      a note
      """
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      - item one
      - item two

      ```
      echo hi
      ```
      """
    When I read the view of ".gtd/TODO.md" via a spawned gtd ui
    Then the rendered view has a "heading" block at index 0
    And the rendered view has a "list" block at index 1
    And the rendered view has a "code" block at index 2

  @live
  Scenario: editing a block of a mode-less steering file writes the bytes to disk
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
                  "* **": planning
              planning:
                actor: human
                file: "TODO.md"
                message: "edit the plan"
      """
    And a commit "gtd(human): planning" that adds "NOTE.md" with:
      """
      a note
      """
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I edit paragraph 0 of ".gtd/TODO.md" with the text "Edited paragraph." via a spawned gtd ui
    Then the file ".gtd/TODO.md" contains "Edited paragraph."

  @live
  Scenario: writing against a stale token refuses instead of clobbering the file
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
                  "* **": planning
              planning:
                actor: human
                file: "TODO.md"
                message: "edit the plan"
      """
    And a commit "gtd(human): planning" that adds "NOTE.md" with:
      """
      a note
      """
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I attempt to edit paragraph 0 of ".gtd/TODO.md" with the text "Clobber attempt." using a stale token via a spawned gtd ui
    Then the write is refused with reason "stale-token"
    And the file ".gtd/TODO.md" contains "Paragraph zero here."
    And the file ".gtd/TODO.md" does not contain "Clobber attempt."

  @live
  Scenario: handing off a genuinely mode-less rest (no mode key at all) exits 0 with the edit on disk
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
                  "* **": planning
              planning:
                actor: human
                file: "TODO.md"
                message: "edit the plan"
      """
    And a commit "gtd(human): planning" that adds "NOTE.md" with:
      """
      a note
      """
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I hand off ".gtd/TODO.md" with the text "handed back" to a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/TODO.md" contains "handed back"

  @live
  Scenario: ui.format rewrites a mode-less write, and a second write against the returned hash still succeeds
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      ui:
        format: 'printf "FORMATTED\n" >> <%= it.file %>'
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
                  "* **": planning
              planning:
                actor: human
                file: "TODO.md"
                message: "edit the plan"
      """
    And a commit "gtd(human): planning" that adds "NOTE.md" with:
      """
      a note
      """
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I write "First edit." then "Second edit." to paragraph 0 of ".gtd/TODO.md" via a spawned gtd ui, reusing the first write's returned hash
    Then the file ".gtd/TODO.md" contains "FORMATTED"
    And the file ".gtd/TODO.md" contains "Second edit."
    And the second write succeeded

  # `resolveBindHost`/`resolveCertPair` themselves (the Tailscale-scan
  # default, --self-signed, ui.cert/ui.key) are pinned deterministically at
  # the unit tier — `src/ui/Server.test.ts`'s own `describe("resolveBindHost"
  # / "resolveCertPair")` blocks, which mock `pickBindHostFromSystem` so the
  # refusal never depends on whatever network interfaces the runner actually
  # has. A `@live` scenario asserting "no Tailscale interface found" can't
  # make that same guarantee — it would depend on the CI/dev machine's real
  # network shape — so that coverage is not duplicated here.

  # Package 02's own printed-URL-carries-the-tailnet-hostname
  # coverage (both the probe-answers and probe-empty paths, `CommandRunner`-
  # doubled) lives at the unit tier instead of here, in
  # `src/ui/Server.test.ts`'s own `describe("runUiCommand")` block: unlike
  # every other assertion in THIS file, it needs `pickBindHostFromSystem` and
  # `CommandRunner` both mockable, which only the in-process unit tier gives —
  # a spawned `@live` subprocess can inject neither, and would additionally
  # depend on the runner's own machine genuinely carrying a Tailscale CGNAT
  # interface to bind at all.
