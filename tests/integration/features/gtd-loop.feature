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

  Scenario: Carries the memory scope across a loop and clears it at a phase boundary
    # Two agent phases: `working` (scope "work") then a fixing loop (scope
    # "fix") that re-enters twice. The stub echoes the memory env vars gtd-loop
    # exports, so we can see it start fresh at each new scope (RESUME=0) and
    # resume the same session the second time the SAME scope repeats (RESUME=1)
    # — the retain-within-a-loop / clear-at-a-boundary contract. The check's
    # attempt counter lives in .git (never the work tree, so gtd's pending diff
    # only ever sees .gtd/FEEDBACK.md), forcing exactly two fix laps.
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
            memory: work
            prompt: "Create src/fix.ts for the initial build."
            on:
              "* **": checking
          checking:
            actor: check
            script: |
              set +e
              mkdir -p .gtd
              c=".git/testcount"
              n=$(cat "$c" 2>/dev/null || echo 0)
              n=$((n + 1))
              echo "$n" > "$c"
              if [ "$n" -lt 3 ]; then echo "fail $n" > .gtd/FEEDBACK.md; else rm -f .gtd/FEEDBACK.md; fi
            on:
              "A .gtd/FEEDBACK.md": fixing
              "M .gtd/FEEDBACK.md": fixing
              "D .gtd/FEEDBACK.md": done
              "C": done
          fixing:
            actor: agent
            memory: fix
            prompt: "Fix the failing check."
            on:
              "* **": checking
          done:
            commit: "chore: fixed"
      """
    And a commit "gtd(agent): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      echo "AGENT MEMORY=${GTD_LOOP_MEMORY} RESUME=${GTD_LOOP_MEMORY_RESUME}"
      case "$GTD_LOOP_PROMPT" in
        *"initial build"*)
          mkdir -p src
          echo 'export const x = 1' > src/fix.ts
          ;;
        *"Fix the failing"*)
          echo "// touched at ${GTD_LOOP_MEMORY}" >> src/fix.ts
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run gtd-loop
    Then it succeeds
    And stdout contains "AGENT MEMORY=work RESUME=0"
    And stdout contains "AGENT MEMORY=fix RESUME=0"
    And stdout contains "AGENT MEMORY=fix RESUME=1"
    And stdout contains "--- Your turn (idle) ---"

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
