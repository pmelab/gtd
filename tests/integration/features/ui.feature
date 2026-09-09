Feature: gtd ui — the phone/web client's HTTPS listener

  `gtd ui` binds a long-lived HTTPS server exposing the phone/web client for
  THIS worktree — the invoking directory, there is no fleet and no configured
  list of roots to discover one from. Unlike `gtd visualize`, `needs: "state"`:
  it shares the repo-root and at-least-one-commit guard with every other
  state command. Before ever resolving a bind host or a certificate, it reads
  the served worktree's own beat (a real `gtd next --json` subprocess spawn)
  and refuses — exit 2, no port ever bound — unless that beat rests with a
  HUMAN actor, non-idle, carrying a `file` and a `mode` that resolves to a
  registered steering format: every other rest has no phone screen to show it
  on, regardless of its reported content kind. That beat read needs a REAL
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
  Scenario: an idle worktree (the default rest of a fresh project) refuses, naming it idle
    Given a test project
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "idle"

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
  Scenario: a dirty message rest (capture), resting with a human but with no steering file, refuses on the actor axis
    Given a test project
    And a file "scratch.txt" with:
      """
      uncommitted content — a capture rest, never landed
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
  Scenario: a prompt rest resting with a human, whose mode resolves to no registered steering format, refuses naming the unregistered mode
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
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "custom-mode"

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

  # `resolveBindHost`/`resolveCertPair` themselves (the Tailscale-scan
  # default, --self-signed, ui.cert/ui.key) are pinned deterministically at
  # the unit tier — `src/ui/Server.test.ts`'s own `describe("resolveBindHost"
  # / "resolveCertPair")` blocks, which mock `pickBindHostFromSystem` so the
  # refusal never depends on whatever network interfaces the runner actually
  # has. A `@live` scenario asserting "no Tailscale interface found" can't
  # make that same guarantee — it would depend on the CI/dev machine's real
  # network shape — so that coverage is not duplicated here.

  # ── Package 02: the printed URL/QR code carry the tailnet hostname when
  # detection answers, and the CGNAT IP exactly as before when it doesn't —
  # both driven by a fake `tailscale` on $PATH, never the real binary, and
  # both spawned WITHOUT --host so `resolveBindHost`'s own real-system scan
  # (this machine's actual Tailscale interface) and the new probe both run
  # for real, exactly like a plain `gtd ui`. ──────────────────────────────

  @live
  Scenario: the printed URL and QR code carry the Tailscale hostname when the probe finds a running backend
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
    And a fake tailscale binary on PATH reporting a running backend with hostname "phone.tailnet.ts.net"
    When I spawn gtd ui without --host and capture its printed URL
    Then stdout contains "https://phone.tailnet.ts.net:"

  @live
  Scenario: the printed URL and QR code carry the CGNAT IP, exactly as before, when the probe finds no backend
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
    And a fake tailscale binary on PATH reporting no backend
    When I spawn gtd ui without --host and capture its printed URL
    Then stdout does not contain "tailnet"
    And stdout matches "https:\/\/\d+\.\d+\.\d+\.\d+:"
