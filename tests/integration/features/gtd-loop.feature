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

  Scenario: A human-gate return lap runs the agent's fold turn instead of false-stalling
    # planning's prompt is STATIC (no rendered diff/hash in it), so a return lap
    # through plan-review back to planning presents the identical state+content
    # the driver last saw — without HEAD tracking, the stall check mistakes that
    # for no progress, even though a commit (plan-review -> planning) landed in
    # between.
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
            prompt: "Refine the plan in .gtd/PLAN.md."
            on:
              "* **": plan-review
          plan-review:
            actor: human
            file: .gtd/PLAN.md
            message: "review the plan"
            on:
              "C": building
              "* **": planning
          building:
            actor: agent
            prompt: "Build it: write src/app.ts."
            on:
              "* **": done
          done:
            commit: "chore: plan built"
      """
    And a commit "gtd(human): idle → planning" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      case "$GTD_LOOP_PROMPT" in
        *"Refine the plan"*)
          mkdir -p .gtd
          echo "- refined" >> .gtd/PLAN.md
          ;;
        *"Build it"*)
          mkdir -p src
          echo "export const app = () => {}" > src/app.ts
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    And $EDITOR is a script that appends "looks good, one tweak" on its first open only
    When I run bare gtd
    Then it succeeds
    And the git log contains "chore: plan built"
    And stderr does not contain "no progress at 'planning'"

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

  # The scenarios below prove bin/gtd's editor-at-gate behaviour (see
  # handle_human_gate and the --no-edit/GTD_NO_EDIT dispatch at the top of
  # bin/gtd): with editing on (the default) a human gate opens the fake
  # editor before stepping human, so an edit matching the gate's `on` pattern
  # lets the loop keep driving, while a no-op editor halts exactly like
  # today's edit-disabled behaviour. `reviewing` is a second, mid-cycle human
  # gate (distinct from the opening `idle` gate) so these scenarios prove the
  # MAIN LOOP's gate handling, not just the opening move's. `idle` here is a
  # silent check-actor no-op (not a message gate) so that, once the cycle
  # reaches `done` and falls back to the workflow's initial state, the loop
  # settles quietly instead of re-opening the editor a second time.

  Scenario: With editing on, an edit matching the gate's pattern lets the loop drive past a human gate
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
              "A .gtd/FEEDBACK.md": idle
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
              "C": reviewing
          reviewing:
            actor: human
            file: .gtd/REVIEW.md
            message: "sign off on the build"
            on:
              "A .gtd/REVIEW.md": done
          done:
            commit: "chore: build reviewed"
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
    And $EDITOR is a script that appends "Looks good." to the opened file
    When I run bare gtd
    Then it succeeds
    And the fake editor was opened on ".gtd/REVIEW.md"
    And the git log contains "chore: build reviewed"
    And stdout contains "[done] settled — nothing left to do"

  Scenario: With editing on, a no-op editor halts the loop at the gate instead of looping forever
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
              "A .gtd/FEEDBACK.md": idle
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
              "C": reviewing
          reviewing:
            actor: human
            file: .gtd/REVIEW.md
            message: "sign off on the build"
            on:
              "A .gtd/REVIEW.md": done
          done:
            commit: "chore: build reviewed"
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
    And $EDITOR is a no-op script
    When I run bare gtd
    Then it succeeds
    And the fake editor was opened on ".gtd/REVIEW.md"
    And stdout contains "[you] done for now (nothing captured)"
    And ".gtd/REVIEW.md" does not exist

  Scenario: --no-edit restores the halt-at-gate behaviour, never launching the editor
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
              "A .gtd/FEEDBACK.md": idle
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
              "C": reviewing
          reviewing:
            actor: human
            file: .gtd/REVIEW.md
            message: "sign off on the build"
            on:
              "A .gtd/REVIEW.md": done
          done:
            commit: "chore: build reviewed"
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
    And $EDITOR is a script that appends "should never be seen" to the opened file
    When I run gtd loop --no-edit
    Then it succeeds
    And stdout contains "[you]  reviewing"
    And the fake editor was not invoked

  Scenario: GTD_NO_EDIT set to a non-empty value behaves identically to --no-edit
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
              "A .gtd/FEEDBACK.md": idle
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
              "C": reviewing
          reviewing:
            actor: human
            file: .gtd/REVIEW.md
            message: "sign off on the build"
            on:
              "A .gtd/REVIEW.md": done
          done:
            commit: "chore: build reviewed"
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
    And $EDITOR is a script that appends "should never be seen" to the opened file
    And GTD_NO_EDIT is set to "1"
    When I run bare gtd
    Then it succeeds
    And stdout contains "[you]  reviewing"
    And the fake editor was not invoked

  Scenario: --edit overrides an ambient GTD_NO_EDIT, forcing the editor open at the human gate anyway
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
              "A .gtd/FEEDBACK.md": idle
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
              "C": reviewing
          reviewing:
            actor: human
            file: .gtd/REVIEW.md
            message: "sign off on the build"
            on:
              "A .gtd/REVIEW.md": done
          done:
            commit: "chore: build reviewed"
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
    And $EDITOR is a script that appends "Looks good." to the opened file
    And GTD_NO_EDIT is set to "1"
    When I run "--edit" via gtd
    Then it succeeds
    And the fake editor was opened on ".gtd/REVIEW.md"
    And the git log contains "chore: build reviewed"
    And stdout contains "[done] settled — nothing left to do"

  Scenario: --edit says so and keeps driving when the current rest isn't a human gate
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
    And $EDITOR is a no-op script
    When I run "--edit" via gtd
    Then it succeeds
    And stdout contains "--edit: not at a human gate yet — continuing to drive"
    And "src/calc.ts" exists
    And the git log contains "chore: calculator done"
    And stdout contains "[you] done for now (nothing captured)"

  Scenario: --edit and --once combine freely, forcing one human gate open and stopping right after
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
              "A .gtd/FEEDBACK.md": idle
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
              "C": reviewing
          reviewing:
            actor: human
            file: .gtd/REVIEW.md
            message: "sign off on the build"
            on:
              "A .gtd/REVIEW.md": done
          done:
            commit: "chore: build reviewed"
      """
    And a commit "gtd(check): checking → reviewing" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And $EDITOR is a script that appends "Looks good." to the opened file
    When I run "--edit --once" via gtd
    Then it succeeds
    And the fake editor was opened on ".gtd/REVIEW.md"
    And the git log contains "chore: build reviewed"
    And stdout does not contain "settled"

  Scenario: --edit combined with --no-edit is a usage error rather than picking one silently
    Given a test project
    And the workflow
    When I run "--edit --no-edit" via gtd
    Then the exit code is 2
    And stderr contains "--edit and --no-edit are mutually exclusive"

  Scenario: --edit combined with --no-edit after loop is a usage error rather than picking one silently
    Given a test project
    And the workflow
    When I run "loop --edit --no-edit" via gtd
    Then the exit code is 2
    And stderr contains "--edit and --no-edit are mutually exclusive"

  Scenario: Prints each transition once even after the review checkout window rewinds HEAD
    # await-review opens a real review checkout window (reviewWindow: true, no
    # `mode: review` so the plain "D .gtd/REVIEW.md" pattern is the sign-off,
    # not the sign-off gate). While the window is open report_commits sees a
    # rewound HEAD; deciding is a non-squash check between the sign-off and the
    # squash, keeping the earlier transitions reachable at the window-close
    # beat — a driver with a per-beat head_before would re-print them there.
    # `idle` stays a silent check-actor no-op (same idiom as the herdr-report
    # scenario above) so settling back to it after `done` never reopens the
    # editor a second time — the fake editor here DELETES its target, which
    # would abort the run if reopened on "." at idle.
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
    And $EDITOR is a script that deletes the opened file
    When I run bare gtd
    Then it succeeds
    And the git log contains "chore: reviewed"
    And stdout contains "working → checking" exactly 1 times
    And stdout contains "checking → reviewing" exactly 1 times
    And stdout contains "reviewing → await-review" exactly 1 times

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

  # The scenarios below prove bin/gtd's Herdr pane reporting (see its
  # `herdr_ok`/`herdr_report`/`herdr_notify`/`herdr_release` helpers): it shells
  # out to a `herdr` CLI only when HERDR_ENV=1, HERDR_PANE_ID is set, and
  # `herdr` resolves on PATH — "Given a fake herdr binary" provisions exactly
  # that (a logging stub on PATH plus the two env vars), and every scenario
  # ABOVE this comment (none of which use that step) is the proof of the
  # complement: with no fake herdr binary, gtd's behavior is unchanged —
  # it never even tries to invoke a `herdr` command.

  Scenario: Reports working then idle/release to Herdr for an agent turn that settles cleanly
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
    And a fake herdr binary
    When I run bare gtd
    Then it succeeds
    And stdout contains "[done] settled — nothing left to do"
    And the fake herdr log contains, in order:
      """
      pane report-agent test-pane --source herdr:gtd --agent gtd --state working --message working
      pane report-agent test-pane --source herdr:gtd --agent gtd --state idle --message checking
      pane release-agent test-pane --source herdr:gtd --agent gtd
      """

  Scenario: Reports blocked and notifies Herdr when halting at a human gate
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
    And a fake herdr binary
    When I run bare gtd
    Then it succeeds
    And stdout contains "[you]  idle"
    And the fake herdr log contains, in order:
      """
      pane report-agent test-pane --source herdr:gtd --agent gtd --state blocked --message idle
      notification show gtd needs you
      """

  Scenario: GTD_NO_NOTIFY set to a non-empty value suppresses the human-gate notification but still reports blocked
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
    And a fake herdr binary
    And GTD_NO_NOTIFY is set to "1"
    When I run bare gtd
    Then it succeeds
    And stdout contains "[you]  idle"
    And the fake herdr log contains, in order:
      """
      pane report-agent test-pane --source herdr:gtd --agent gtd --state blocked --message idle
      """
    And the fake herdr log does not contain "notification show"

  Scenario: --no-notify suppresses the human-gate notification but still reports blocked
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
    And a fake herdr binary
    When I run gtd loop --no-notify
    Then it succeeds
    And stdout contains "[you]  idle"
    And the fake herdr log contains, in order:
      """
      pane report-agent test-pane --source herdr:gtd --agent gtd --state blocked --message idle
      """
    And the fake herdr log does not contain "notification show"

  Scenario: Reports idle and releases the pane to Herdr when a script rest settles cleanly
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
    And a fake herdr binary
    When I run bare gtd
    Then it succeeds
    And stdout contains "[done] settled — nothing left to do"
    And the fake herdr log contains, in order:
      """
      pane report-agent test-pane --source herdr:gtd --agent gtd --state idle --message watching
      pane release-agent test-pane --source herdr:gtd --agent gtd
      """

  Scenario: Reports blocked and notifies Herdr via the exit trap when the loop stops on failure
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
    And a fake herdr binary
    When I run bare gtd
    Then it fails
    And stderr contains "no progress at 'working'"
    And the fake herdr log contains, in order:
      """
      pane report-agent test-pane --source herdr:gtd --agent gtd --state blocked --message working: exited 1
      notification show gtd stopped
      """

  Scenario: --no-notify suppresses the exit-trap notification
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
    And a fake herdr binary
    When I run gtd loop --no-notify
    Then it fails
    And stderr contains "no progress at 'working'"
    And the fake herdr log contains, in order:
      """
      pane report-agent test-pane --source herdr:gtd --agent gtd --state blocked --message working: exited 1
      """
    And the fake herdr log does not contain "notification show"

  Scenario: Reports blocked to Herdr while the loop's editor is open at a human gate, then working once it closes
    # Same shape as "With editing on, an edit matching the gate's pattern lets
    # the loop drive past a human gate" above — `reviewing` is the mid-loop
    # human gate `handle_human_gate` opens the editor for. `idle` stays a
    # silent check-actor no-op so settling back to it after `done` never
    # reopens the editor a second time.
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
              "A .gtd/FEEDBACK.md": idle
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
              "C": reviewing
          reviewing:
            actor: human
            file: .gtd/REVIEW.md
            message: "sign off on the build"
            on:
              "A .gtd/REVIEW.md": done
          done:
            commit: "chore: build reviewed"
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
    And a fake herdr binary
    And $EDITOR is a script that appends "Looks good." to the opened file
    When I run bare gtd
    Then it succeeds
    And the fake editor was opened on ".gtd/REVIEW.md"
    And the fake herdr log contains, in order:
      """
      pane report-agent test-pane --source herdr:gtd --agent gtd --state blocked --message reviewing
      pane report-agent test-pane --source herdr:gtd --agent gtd --state working --message reviewing
      """
    And the git log contains "chore: build reviewed"

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
    # A green suite is nothing to fix: the empty `gtd(human): fix-check` entry
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
