@live
Feature: gtd loop — the packaged reference loop driver (v3)

  `bin/gtd` is the single installable entry point: bare `gtd` (no arguments)
  and `gtd loop` (no further arguments) both run the installable
  implementation of the loop protocol documented in docs/loop.md, while any
  other first argument (e.g. `gtd status`) hands off to the real bundle
  unchanged. These scenarios spawn `bin/gtd` as a real subprocess (never the
  real `claude` CLI — a stub agent script stands in, wired through
  `GTD_LOOP_AGENT_CMD`) against a minimal custom `.gtdrc` `workflow:` to prove
  its dispatch: an agent prompt turn chained through a script (check) turn,
  settling when a script rest makes no progress, stalling when an agent's
  turn doesn't either, `gtd loop` behaving identically to bare `gtd`, a
  `gtd loop` with an extra argument being rejected as a usage error, and a
  real subcommand being forwarded to the bundle untouched.

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
    When I run bare gtd
    Then it succeeds
    And stdout contains "--- Your turn (idle) ---"
    And the git log contains "chore: calculator done"
    And "src/calc.ts" exists

  Scenario: Captures the human's pending edit at the opening gate, so the human only runs gtd
    # The machine rests at the initial human gate `idle` (no gtd commit — the
    # test project's "chore: initial commit" resolves to the initial state) with
    # an uncommitted NOTE.md sketch. The human never runs `gtd step human`: the
    # loop's opening move captures the sketch (idle's `* **` -> working), then
    # drives working -> checking -> done. Without that opening capture the loop
    # would just print the idle message and exit, so src/calc.ts is the proof it
    # advanced past the gate on its own.
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
    And a file "NOTE.md" with:
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
    When I run bare gtd
    Then it succeeds
    And "src/calc.ts" exists
    And the git log contains "chore: calculator done"

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
    When I run bare gtd
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
    When I run bare gtd
    Then it succeeds
    And stdout contains "AGENT MEMORY=work RESUME=0"
    And stdout contains "AGENT MEMORY=fix RESUME=0"
    And stdout contains "AGENT MEMORY=fix RESUME=1"
    And stdout contains "--- Your turn (idle) ---"

  Scenario: Runs the self-validation gate after a producing agent turn and re-prompts until the steering file is well-formed
    # `planning` declares file:/mode: (.gtd/PLAN.md as `qa`), so its output has
    # a checkable format. The stub writes a MALFORMED plan first (a bare `###`
    # question heading with no question text); the loop runs `gtd validate`, it
    # fails, and the loop re-prompts the SAME turn with the findings (prompt now
    # contains "does not pass"), on which the stub writes a valid plan — only
    # then does the loop step, squashing to done and halting.
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
              "* **": planning
          planning:
            actor: agent
            file: .gtd/PLAN.md
            mode: qa
            prompt: "Write .gtd/PLAN.md with the plan."
            on:
              "* **": done
          done:
            commit: "chore: planned"
      """
    And a commit "gtd(agent): planning" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      mkdir -p .gtd
      case "$GTD_LOOP_PROMPT" in
        *"does not pass"*)
          echo "AGENT: fixing the plan"
          cat > .gtd/PLAN.md <<'PLAN'
      Plan: build the calculator. No open questions.
      PLAN
          ;;
        *)
          echo "AGENT: first draft"
          cat > .gtd/PLAN.md <<'PLAN'
      Plan: build the calculator.

      ## Open Questions

      ###

      Forgot to write the question.
      PLAN
          ;;
      esac
      """
    When I run bare gtd
    Then it succeeds
    And stdout contains "AGENT: first draft"
    And stdout contains "AGENT: fixing the plan"
    And the git log contains "chore: planned"

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
    When I run bare gtd
    Then it fails
    And stderr contains "no progress at 'working'"

  Scenario: gtd loop with no further arguments behaves identically to bare gtd
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
    When I run gtd loop
    Then it succeeds
    And stdout contains "--- Your turn (idle) ---"
    And the git log contains "chore: calculator done"
    And "src/calc.ts" exists

  Scenario: gtd loop rejects an extra argument as a usage error without running node
    Given a test project
    And I record the commit count
    When I run gtd loop extra
    Then the exit code is 2
    And stderr contains "gtd: 'loop' takes no arguments"
    And the commit count is unchanged

  Scenario: any other first argument hands off to the bundle, forwarding it untouched
    Given a test project
    And the workflow
    When I run "status" via gtd
    Then it succeeds
    And stdout contains "State: idle"
