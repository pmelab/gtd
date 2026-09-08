Feature: gtd ui — the phone/web client's HTTPS listener

  `gtd ui` binds a long-lived HTTPS server exposing the phone/web client for
  THIS worktree — the invoking directory, there is no fleet and no configured
  list of roots to discover one from. Unlike `gtd visualize`, `needs: "state"`:
  it shares the repo-root and at-least-one-commit guard with every other
  state command. Before ever resolving a bind host or a certificate, it reads
  the served worktree's own beat (a real `gtd next --json` subprocess spawn)
  and refuses — exit 2, no port ever bound — unless that beat rests at a
  `prompt` step carrying a `file` and a `mode` that resolves to a registered
  steering format: every other rest has no phone screen to show it on. That
  beat read needs a REAL worktree underneath it, so every scenario below that
  gets past it (or specifically proves a NON-renderable rest) is `@live`; only
  the two fast, purely config/guard-level refusals stay `@inmem`.

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
  Scenario: a clean message rest (non-idle) refuses, naming the message kind
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
    And stderr contains "message"

  @live
  Scenario: a dirty message rest (capture) refuses, naming the capture kind
    Given a test project
    And a file "scratch.txt" with:
      """
      uncommitted content — a capture rest, never landed
      """
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "capture"

  @live
  Scenario: a script rest refuses, naming the script kind
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
    And stderr contains "script"

  @live
  Scenario: a stalled rest (a clean-tree agent attempt at a prompt state) refuses, naming the stalled kind
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
    And stderr contains "stalled"


  @live
  Scenario: a prompt rest whose mode resolves to no registered steering format refuses
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

  # `resolveBindHost`/`resolveCertPair` themselves (the Tailscale-scan
  # default, --self-signed, ui.cert/ui.key) are pinned deterministically at
  # the unit tier — `src/ui/Server.test.ts`'s own `describe("resolveBindHost"
  # / "resolveCertPair")` blocks, which mock `pickBindHostFromSystem` so the
  # refusal never depends on whatever network interfaces the runner actually
  # has. A `@live` scenario asserting "no Tailscale interface found" can't
  # make that same guarantee — it would depend on the CI/dev machine's real
  # network shape — so that coverage is not duplicated here.
