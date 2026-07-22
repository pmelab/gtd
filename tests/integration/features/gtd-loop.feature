@live
Feature: gtd-loop — the packaged reference loop driver (v3)

  `bin/gtd-loop` is the installable implementation of the loop protocol
  documented in docs/loop.md. These scenarios spawn it as a real subprocess
  (never the real `claude` CLI — a stub agent script stands in, wired through
  `GTD_LOOP_AGENT_CMD`) against a minimal custom `.gtdrc` `workflow:` to prove
  its dispatch: an agent prompt turn chained through a script (check) turn,
  settling when a script rest makes no progress, and stalling when an
  agent's turn doesn't either.

  Scenario: Chains an agent turn through a check turn and halts back at idle
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "write NOTE.md to start a cycle"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "Build the package described below: write src/calc.ts exporting add(a, b)."
            on:
              "* **": checking
          checking:
            actor: check
            script: |
              if [ -f src/calc.ts ] && grep -q add src/calc.ts; then rm -f .gtd/FEEDBACK.md; else mkdir -p .gtd && echo "missing add" > .gtd/FEEDBACK.md; fi
            on:
              "A .gtd/FEEDBACK.md": working
              "M .gtd/FEEDBACK.md": working
              "C": done
          done:
            commit: "chore: calculator done"
      """
    And a commit "gtd(agent): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      case "$GTD_LOOP_PROMPT" in
        *"Build the package described below"*)
          mkdir -p src
          cat > src/calc.ts <<'CALC'
      export const add = (a, b) => a + b
      CALC
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run gtd-loop
    Then it succeeds
    And stdout contains "--- Your turn (idle) ---"
    And the git log contains "chore: calculator done"
    And "src/calc.ts" exists

  Scenario: Settles instead of looping forever when a script rest makes no progress
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "write NOTE.md to start a cycle"
            on:
              "* **": watching
          watching:
            actor: check
            script: "true"
            on:
              "A .gtd/FEEDBACK.md": idle
      """
    And a commit "gtd(check): watching" that adds "NOTE.md" with:
      """
      note
      """
    When I run gtd-loop
    Then it succeeds
    And stdout contains "--- Settled (watching: check passed, nothing to do) ---"

  Scenario: Stops instead of spinning when the agent's turn makes no progress
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "write NOTE.md to start a cycle"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "Build the package described below: write src/calc.ts exporting add(a, b)."
            on:
              "* **": checking
          checking:
            actor: check
            script: "true"
            on:
              "A .gtd/FEEDBACK.md": working
      """
    And a commit "gtd(agent): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      : # does nothing — the build prompt is never acted on
      """
    When I run gtd-loop
    Then it fails
    And stderr contains "no progress at 'working'"
