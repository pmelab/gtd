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
    And stdout contains "[you]  idle"
    And the git log contains "chore: calculator done"
    And "src/calc.ts" exists

  Scenario: A check script's own cleanup mechanic (a sole swept deletion) advances the cycle instead of stalling
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
            prompt: "Build the package described below: write src/calc.ts exporting add(a, b), and also leave a leaked.md scratch file behind."
            on:
              "* **": checking
          checking:
            actor: check
            script: |
              rm -f leaked.md
              if [ -f src/calc.ts ] && grep -q add src/calc.ts; then rm -f .gtd/FEEDBACK.md; else mkdir -p .gtd && echo "missing add" > .gtd/FEEDBACK.md; fi
            on:
              "A .gtd/FEEDBACK.md": working
              "M .gtd/FEEDBACK.md": working
              "* **": reviewing
              "C": reviewing
          reviewing:
            actor: human
            message: "sign off to finish"
            on:
              "* **": done
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
          echo "scratch notes" > leaked.md
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run bare gtd
    Then it succeeds
    And stdout contains "[you]  reviewing"
    And the last commit subject is "gtd(check): checking → reviewing"
    And "leaked.md" does not exist
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
    And stdout contains "[done] settled — nothing left to do"

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
    And the log file contains "AGENT MEMORY=work RESUME=0"
    And the log file contains "AGENT MEMORY=fix RESUME=0"
    And the log file contains "AGENT MEMORY=fix RESUME=1"
    And stdout contains "[you]  idle"

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
    And the log file contains "AGENT: first draft"
    And the log file contains "AGENT: fixing the plan"
    And stdout contains "[fix] attempt 1"
    And the git log contains "chore: planned"

  Scenario: Does not print validate findings on a fix attempt, only logs them
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
          cat > .gtd/PLAN.md <<'PLAN'
      Plan: build the calculator. No open questions.
      PLAN
          ;;
        *)
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
    And stdout contains "[fix] attempt 1"
    And stderr does not contain "has no question text"
    And the log file contains "has no question text"

  Scenario: Renders a transition line and a bare self-loop capture line, logging what gtd step committed
    # `working -> checking` differs (a real transition), while `checking`'s own
    # "A .gtd/FEEDBACK.md": checking pattern targets itself (a self-loop, the
    # bare `gtd(check): checking` capture form) before the second check attempt
    # finally settles into `done`.
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
              mkdir -p .gtd
              c=".git/testcount"
              n=$(cat "$c" 2>/dev/null || echo 0)
              n=$((n + 1))
              echo "$n" > "$c"
              if [ "$n" -lt 2 ]; then echo "retry" > .gtd/FEEDBACK.md; else rm -f .gtd/FEEDBACK.md; fi
            on:
              "A .gtd/FEEDBACK.md": checking
              "M .gtd/FEEDBACK.md": checking
              "D .gtd/FEEDBACK.md": done
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
    And stdout contains "working → checking"
    And stdout contains "gtd(check): checking"
    And the log file contains "committed: gtd(agent): working → checking"
    And the log file contains "committed: gtd(check): checking"
    And "src/calc.ts" exists
    And the git log contains "chore: calculator done"

  Scenario: Caps a transition's changed-file rows at 3, with an overflow row for the rest
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
            prompt: "Build the package described below: write four files."
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
      mkdir -p src
      echo a > src/a.ts
      echo b > src/b.ts
      echo c > src/c.ts
      echo d > src/d.ts
      """
    When I run bare gtd
    Then it succeeds
    And stdout contains "-> working → checking"
    And stdout contains "src/a.ts"
    And stdout contains "src/b.ts"
    And stdout contains "src/c.ts"
    And stdout contains "(1 more)"
    And stdout does not contain "src/d.ts"

  Scenario: Exactly three changed files show all three rows and no overflow marker
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
            prompt: "Build the package described below: write three files."
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
      mkdir -p src
      echo a > src/a.ts
      echo b > src/b.ts
      echo c > src/c.ts
      """
    When I run bare gtd
    Then it succeeds
    And stdout contains "src/a.ts"
    And stdout contains "src/b.ts"
    And stdout contains "src/c.ts"
    And stdout does not contain "more)"

  Scenario: Redirects the check script's own output to the log file instead of the terminal
    Given a test project
    And the loop driver leaked GTD_LOOP_LOG as "/somewhere/else/.git/gtd-loop.log"
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
            script: |
              echo "CHECK: verifying the tree"
              true
            on:
              "A .gtd/FEEDBACK.md": idle
      """
    And a commit "gtd(check): watching" that adds "NOTE.md" with:
      """
      note
      """
    When I run bare gtd
    Then it succeeds
    And stdout does not contain "CHECK: verifying the tree"
    And the log file contains "CHECK: verifying the tree"

  Scenario: Surfaces a check script's failure output but still decides the outcome from the tree
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          checking:
            actor: check
            initial: true
            script: |
              echo "CHECK BOOM" >&2
              mkdir -p .gtd
              echo x > .gtd/FEEDBACK.md
              exit 1
            on:
              "A .gtd/FEEDBACK.md": reviewing
          reviewing:
            actor: human
            message: "sign off"
      """
    When I run bare gtd
    Then it succeeds
    And stderr contains "CHECK BOOM"
    And stderr contains "exited 1 — continuing"
    And stdout contains "checking → reviewing"

  Scenario: Renders plain ASCII markers with no ANSI escape codes under NO_COLOR
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
    And NO_COLOR is set to "1"
    When I run bare gtd
    Then it succeeds
    And stdout contains "[agent]"
    And stdout contains "[you]"
    And stdout has no ANSI escape codes
    And stderr has no ANSI escape codes

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
    And stderr contains "see .git/gtd-loop.log"

  Scenario: Prints the agent CLI's own failure output instead of exiting silently
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
      echo "BOOM: agent exploded" >&2
      exit 3
      """
    When I run bare gtd
    Then it fails
    And stderr contains "the agent turn at 'working' failed (exit 3)"
    And stderr contains "BOOM: agent exploded"
    And stderr contains "see .git/gtd-loop.log"

  Scenario: Caps a failing turn's replayed output at 20 lines and points at the log
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
      for i in $(seq 1 30); do printf "line %03d\n" "$i"; done
      exit 1
      """
    When I run bare gtd
    Then it fails
    And stderr contains "line 030"
    And stderr contains "(10 earlier lines in"
    And stderr does not contain "line 001"
    And the log file contains "line 001"

  Scenario: Reports a mid-run failure to resolve the next step with the error marker and the log pointer
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          watching:
            actor: check
            initial: true
            script: "true"
            on:
              "C": working
          working:
            actor: agent
            prompt: "<%~ it.vars.missing.deep %>"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And a commit "gtd(check): watching" that adds "NOTE.md" with:
      """
      note
      """
    When I run bare gtd
    Then it fails
    And stderr contains "[err]"
    And stderr contains "could not determine the next step"
    And stderr contains "Cannot read properties of undefined"
    And stderr contains "see .git/gtd-loop.log"

  Scenario: Stops instead of stepping when a steering file still fails gtd validate after 3 fix attempts
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
      cat > .gtd/PLAN.md <<'PLAN'
      Plan: build the calculator.

      ## Open Questions

      ###

      Forgot to write the question.
      PLAN
      """
    When I run bare gtd
    Then it fails
    And stdout contains "[fix] attempt 3"
    And stderr contains "'planning' still fails"
    And stderr contains "after 3 fix attempts"
    And stderr contains "Stopping rather than stepping with a malformed steering file."
    And stderr contains "see .git/gtd-loop.log"

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
    And stdout contains "[you]  idle"
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

  Scenario: Prints each transition once even after the review checkout window rewinds HEAD
    # await-review opens a real review checkout window (reviewWindow: true, no
    # `mode: review` so the plain "D .gtd/REVIEW.md" pattern is the sign-off,
    # not the sign-off gate). While the window is open HEAD rests rewound at
    # the review base, so the second run starts with its reported-commit
    # marker pointing BELOW commits the first run already printed; the opening
    # move's silent capture must advance the marker past them — a driver with
    # a per-beat head_before (or one that skipped the opening advance) would
    # re-print the first run's transitions once the window closes.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: check
            initial: true
            script: "true"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "Write src/app.ts."
            on:
              "* **": checking
          checking:
            actor: check
            script: "true"
            on:
              "C": reviewing
          reviewing:
            actor: agent
            file: .gtd/REVIEW.md
            prompt: "Write .gtd/REVIEW.md listing the changes to review."
            on:
              "* **": await-review
          await-review:
            actor: human
            file: .gtd/REVIEW.md
            message: "sign off by deleting .gtd/REVIEW.md"
            reviewWindow: true
            on:
              "D .gtd/REVIEW.md": deciding
          deciding:
            actor: check
            script: "true"
            on:
              "C": done
          done:
            commit: "chore: reviewed"
      """
    And a commit "gtd(agent): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      case "$GTD_LOOP_PROMPT" in
        *"Write src/app.ts"*)
          mkdir -p src
          echo "export const app = () => {}" > src/app.ts
          ;;
        *"Write .gtd/REVIEW.md"*)
          mkdir -p .gtd
          echo "- added src/app.ts" > .gtd/REVIEW.md
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run bare gtd
    Then it succeeds
    And stdout contains "working → checking" exactly 1 times
    And stdout contains "checking → reviewing" exactly 1 times
    # The step into await-review itself is already inside the open window (HEAD
    # rests rewound at the review base by the time the driver reports), so that
    # one transition surfaces as the gate line, never as a transition row.
    And stdout contains "[you]  await-review"
    When the file ".gtd/REVIEW.md" is deleted
    And I run bare gtd
    Then it succeeds
    And the git log contains "chore: reviewed"
    And stdout does not contain "working → checking"
    And stdout does not contain "checking → reviewing"
    And stdout does not contain "reviewing → await-review"

  # The scenarios below prove bin/gtd's --once flag (see once_mode in bin/gtd):
  # it restricts the loop to exactly one beat — one script check+step, or one
  # agent prompt+step, or one human gate — then exits, rather than driving all
  # the way to idle/settled. `checking` here self-loops on retry (two runs
  # needed to reach `done`), so a script-beat scenario can prove --once stops
  # after the FIRST run without ever reaching `done`.

  Scenario: --once stops after exactly one script check+step, without settling the whole cycle
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
              mkdir -p .gtd
              c=".git/testcount"
              n=$(cat "$c" 2>/dev/null || echo 0)
              n=$((n + 1))
              echo "$n" > "$c"
              if [ "$n" -lt 2 ]; then echo "retry" > .gtd/FEEDBACK.md; else rm -f .gtd/FEEDBACK.md; fi
            on:
              "A .gtd/FEEDBACK.md": checking
              "M .gtd/FEEDBACK.md": checking
              "D .gtd/FEEDBACK.md": done
              "C": done
          done:
            commit: "chore: calculator done"
      """
    And a commit "gtd(agent): working → checking" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    When I run "--once" via gtd
    Then it succeeds
    And stdout contains "gtd(check): checking"
    And the git log does not contain "chore: calculator done"

  Scenario: --once stops after exactly one agent prompt+step, never reaching the check that follows
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
    When I run "--once" via gtd
    Then it succeeds
    And "src/calc.ts" exists
    And stdout contains "working → checking"
    And the git log does not contain "gtd(check)"
    And the git log does not contain "chore: calculator done"

  Scenario: A still-red suite whose output repeats identically across checks never false-greens into review
    # Drives the REAL bundled unified template (not a custom .gtdrc) through
    # `gtd fix`: a suite that always fails with byte-identical output must
    # never be mistaken for green just because a re-run produces no diff.
    Given a test project
    And the workflow
    And GTD_TESTCOMMAND is set to "sh -c 'echo boom; exit 1'"
    And a stub agent script that responds to prompts with:
      """
      case "$GTD_LOOP_PROMPT" in
        *"the failing test output"*)
          echo x >> scratch.txt
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run "fix" via gtd
    Then it succeeds
    When I run bare gtd
    Then it succeeds
    And stdout contains "[you]  Escalating to a human"
    And the git log does not contain "checking → reviewing"

  Scenario: gtd fix on a green baseline leaves the log untouched
    # A green suite is nothing to fix: the empty `gtd(human): fix-precheck` entry
    # commit and the no-op check are collapsed away rather than left as
    # permanent bookkeeping commits.
    Given a test project
    And the workflow
    And GTD_TESTCOMMAND is set to "true"
    And I record the commit count
    When I run "fix" via gtd
    Then it succeeds
    When I run bare gtd
    Then it succeeds
    And the commit count is unchanged
    And stdout contains "[done] settled — nothing left to do"
