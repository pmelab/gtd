@live
Feature: Claude Code plugin hooks — black-box hook script behavior

  plugins/gtd/hooks/scripts/*.sh and plugins/gtd/scripts/statusline.sh are
  plain bash programs, not gtd itself: each reads a JSON payload from stdin
  and prints JSON (or nothing at all) on stdout, exit 0 either way. These
  scenarios exercise them exactly as Claude Code would invoke them — a real
  fixture repo on disk, real git, the real dev build resolved the same way the
  scripts resolve it (`node_modules/.bin/gtd`, never `GTD_BIN` — see
  hooks/scripts/lib.sh's `resolve_gtd`) — proving the "inert outside gtd
  repos" guarantee, the Stop-hook loop enforcement (block while armed and
  autonomous work remains, allow and self-heal at a human gate), the
  PreToolUse commit guard, and the statusline.

  Background:
    Given a test project
    And the gtd binary is available to plugin scripts

  Scenario: Inert outside a gtd-active repo — every hook script prints nothing and exits 0
    When I run the plugin script "hooks/scripts/session-start.sh"
    Then it succeeds
    And stdout is empty
    When I run the plugin script "hooks/scripts/stop-gate.sh"
    Then it succeeds
    And stdout is empty
    When I run the plugin script "hooks/scripts/pre-tool-guard.sh" with:
      """
      {"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}
      """
    Then it succeeds
    And stdout is empty

  Scenario: SessionStart injects the resolved state and awaited actor as context
    Given the workflow
    When I run the plugin script "hooks/scripts/session-start.sh"
    Then it succeeds
    And stdout contains "hookSpecificOutput"
    And stdout contains "additionalContext"
    And stdout contains "state"
    And stdout contains "idle"
    And stdout contains "awaited actor"
    And stdout contains "human"
    And stdout contains "kind"
    And stdout contains "message"

  Scenario: Stop hook is silent when the loop is not armed
    Given the workflow
    When I run the plugin script "hooks/scripts/stop-gate.sh" with:
      """
      {"stop_consecutive_count": 0, "stop_hook_block_cap": 8}
      """
    Then it succeeds
    And stdout is empty

  Scenario: Stop hook blocks while armed at an autonomous rest
    # A minimal custom workflow whose initial state is an agent "prompt" beat
    # (an autonomous rest) — armed, a bare Stop must not let the session end
    # mid-cycle.
    Given a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          building:
            actor: agent
            initial: true
            prompt: "Write NOTE.md."
            on:
              "* **": done
          done:
            commit: "chore: built"
      """
    And the loop is armed
    When I run the plugin script "hooks/scripts/stop-gate.sh" with:
      """
      {"stop_consecutive_count": 0, "stop_hook_block_cap": 8}
      """
    Then it succeeds
    And stdout contains "decision"
    And stdout contains "block"
    And stdout contains "building"

  Scenario: Stop hook allows and self-heals at a human gate
    # The unified template's initial "idle" state is a human "message" rest —
    # armed, the Stop hook must let the session end here (the loop has reached
    # exactly the gate it was designed to stop at) and remove the marker so it
    # doesn't strand a later, unrelated conversation.
    Given the workflow
    And the loop is armed
    When I run the plugin script "hooks/scripts/stop-gate.sh" with:
      """
      {"stop_consecutive_count": 0, "stop_hook_block_cap": 8}
      """
    Then it succeeds
    And stdout does not contain "block"
    And the loop is no longer armed

  Scenario: PreToolUse denies agent-authored git commit while armed, and stays silent when disarmed
    Given the workflow
    And the loop is armed
    When I run the plugin script "hooks/scripts/pre-tool-guard.sh" with:
      """
      {"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}
      """
    Then it succeeds
    And stdout contains "permissionDecision"
    And stdout contains "deny"
    # A command that merely MENTIONS "commit" (not a git subcommand
    # invocation) must never trip the guard.
    When I run the plugin script "hooks/scripts/pre-tool-guard.sh" with:
      """
      {"tool_name": "Bash", "tool_input": {"command": "git log --format=%s | grep commit"}}
      """
    Then it succeeds
    And stdout is empty
    Given the loop is disarmed
    When I run the plugin script "hooks/scripts/pre-tool-guard.sh" with:
      """
      {"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}
      """
    Then it succeeds
    And stdout is empty

  Scenario: Statusline renders the resolved state in a gtd-active repo
    Given the workflow
    When I run the plugin script "scripts/statusline.sh"
    Then it succeeds
    And stdout matches "^gtd: "
    And stdout contains "idle"

  Scenario: Statusline is empty outside a gtd-active repo
    When I run the plugin script "scripts/statusline.sh"
    Then it succeeds
    And stdout is empty
