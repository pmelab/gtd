@live
Feature: The README's minimal driver — the packaged reference loop protocol

  gtd itself never executes anything: it decides and prints a
  `required`/`optional` script pair (or, at a `prompt` rest, an agent prompt) for
  a DRIVER to run. The README's "A complete minimal driver" section is the
  reference implementation of that protocol — a small paste-and-own bash script,
  not a shipped binary. These scenarios extract that exact fenced block from
  README.md at run time and run it as a real subprocess against a minimal
  custom `.gtdrc` `workflow:` (never the real `claude` CLI — a stub script
  stands in, resolved off the same PATH shim `gtd` itself resolves off), proving
  its dispatch: an agent prompt turn chained through a check turn, the opening
  `--if-resting` capture, resuming after a mid-process restart, settling on a
  script rest with nothing left to do, stopping on a stalled agent turn, the
  self-validation retry loop, and the `sessionId`/`resume` mapping onto
  `--session-id`/`--resume` across two turns in one memory scope.

  Scenario: Chains an agent turn through a check turn and halts at the human gate
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
                message: "write NOTE.md to start a process"
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
    And a stub "claude" CLI that responds to prompts with:
      """
      case "$prompt" in
        *"Build the package described below"*)
          mkdir -p src
          cat > src/calc.ts <<'CALC'
      export const add = (a, b) => a + b
      CALC
          ;;
        *)
          echo "readme-driver test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    And the README's minimal driver
    When I run the README driver
    Then it succeeds
    And stdout contains "write NOTE.md to start a process"
    And the git log contains "chore: calculator done"
    And "src/calc.ts" exists

  Scenario: Captures the human's pending edit at the opening step human --if-resting
    # The machine rests at the initial human gate `idle` (no gtd commit — the
    # test project's "chore: initial commit" resolves to the initial state) with
    # an uncommitted NOTE.md sketch. The driver never runs `gtd step human`
    # separately: its opening move, `gtd_do step human --if-resting`, captures
    # the sketch itself (idle's `* **` -> working) before the beat loop ever
    # starts, then drives working -> checking -> done.
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
                message: "write NOTE.md to start a process"
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
    And a stub "claude" CLI that responds to prompts with:
      """
      case "$prompt" in
        *"Build the package described below"*)
          mkdir -p src
          cat > src/calc.ts <<'CALC'
      export const add = (a, b) => a + b
      CALC
          ;;
        *)
          echo "readme-driver test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    And the README's minimal driver
    When I run the README driver
    Then it succeeds
    And "src/calc.ts" exists
    And the git log contains "chore: calculator done"

  Scenario: Resumes driving on a mid-process restart instead of failing at that capture
    # pmelab/gtd#168: a mid-process restart can leave the machine resting at a
    # message-kind gate that is NOT the human's turn (an "announcing" step some
    # other actor owns). The driver's unconditional opening
    # `gtd step human --if-resting` exits 0 with an empty required/optional
    # script when the resolved rest isn't human's turn, so it reaches the beat
    # loop's own message handling instead of refusing.
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
                message: "write NOTE.md to start a process"
                on:
                  "* **": announcing
              announcing:
                actor: agent
                message: "heads up: work is starting"
                on:
                  "* **": done
              done:
                commit: "chore: done"
      """
    And a commit "gtd(human): announcing" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And the README's minimal driver
    When I run the README driver
    Then it succeeds
    And stdout contains "heads up: work is starting"

  Scenario: Exits 0 on .settled instead of spinning when a script rest makes no progress
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
                message: "write NOTE.md to start a process"
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
    And I record the commit count
    And the README's minimal driver
    When I run the README driver
    Then it succeeds
    And the commit count is unchanged

  Scenario: Stops on .stalled when an agent turn changes nothing
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
                message: "write NOTE.md to start a process"
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
    And a stub "claude" CLI that responds to prompts with:
      """
      : # does nothing — the build prompt is never acted on
      """
    And the README's minimal driver
    When I run the README driver
    Then it fails
    And stderr contains "stalled at working — stopping"

  Scenario: Runs the validate gate and re-prompts until the steering file is well-formed
    # `planning` declares file:/mode: (.gtd/PLAN.md as `qa`), so its output has
    # a checkable format. The stub writes a MALFORMED plan first (a bare `###`
    # question heading with no question text); the driver runs `gtd validate`,
    # it fails, and the driver re-prompts the SAME session with the findings
    # (a prompt now containing "does not pass its own validation script"), on
    # which the stub writes a valid plan — only then does the driver step,
    # squashing to done.
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
                message: "write NOTE.md to start a process"
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
    And a stub "claude" CLI that responds to prompts with:
      """
      mkdir -p .gtd
      case "$prompt" in
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
    And the README's minimal driver
    When I run the README driver
    Then it succeeds
    And the log file contains "AGENT: first draft"
    And the log file contains "AGENT: fixing the plan"
    And the git log contains "chore: planned"
    # The fix re-prompt is the validate script's own output verbatim — not the
    # state's own prompt text prefixed onto it.
    And the log file does not contain "Write .gtd/PLAN.md with the plan."

  Scenario: Gives up after 3 fix attempts rather than stepping a malformed file
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
                message: "write NOTE.md to start a process"
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
    And a stub "claude" CLI that responds to prompts with:
      """
      mkdir -p .gtd
      c=".git/planattempts"
      n=$(( $(cat "$c" 2>/dev/null || echo 0) + 1 ))
      echo "$n" > "$c"
      echo "AGENT: draft attempt $n"
      cat > .gtd/PLAN.md <<'PLAN'
      Plan: build the calculator.

      ## Open Questions

      ###

      Forgot to write the question.
      PLAN
      """
    And the README's minimal driver
    When I run the README driver
    Then it fails
    And stderr contains "does not pass its own validation script"
    And stderr contains "has no question text"
    And the git log does not contain "chore: planned"
    # One initial draft plus 3 retries — never a 5th.
    And the log file contains "AGENT: draft attempt 4"
    And the log file does not contain "AGENT: draft attempt 5"

  Scenario: Maps sessionId/resume onto --session-id/--resume across two turns in one memory scope
    # Both `working` and `fixing` are direct states of the `root` machine, so
    # they share ONE memory scope — the one thing session-table.feature can't
    # reach, since it tests gtd's own per-scope table, not a driver's flag
    # mapping. The stub records the `--session-id` it receives on the first
    # turn, then on the second turn compares the `--resume` value it receives
    # against that recording — proof the driver mapped `sessionId`/`resume`
    # onto the right flags rather than minting an unrelated session.
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
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "first turn"
                on:
                  "* **": fixing
              fixing:
                actor: agent
                prompt: "second turn"
                on:
                  "* **": done
              done:
                commit: "chore: done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      Build a thing.
      """
    And a stub "claude" CLI that responds to prompts with:
      """
      mkdir -p src
      case "$prompt" in
        *"first turn"*)
          echo 'export const x = 1' > src/thing.ts
          prev=""
          for a in "$@"; do
            [ "$prev" = "--session-id" ] && printf '%s' "$a" > .git/first-session-id
            prev="$a"
          done
          ;;
        *"second turn"*)
          echo "// touched" >> src/thing.ts
          expected="$(cat .git/first-session-id 2>/dev/null || echo MISSING)"
          prev="" got=""
          for a in "$@"; do
            [ "$prev" = "--resume" ] && got="$a"
            prev="$a"
          done
          if [ -n "$got" ] && [ "$got" = "$expected" ]; then
            echo "SESSION MATCH: $got"
          else
            echo "SESSION MISMATCH: got=$got expected=$expected"
          fi
          ;;
        *)
          echo "readme-driver test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    And the README's minimal driver
    When I run the README driver
    Then it succeeds
    And the log file contains "SESSION MATCH"
    And the log file does not contain "SESSION MISMATCH"
    And the git log contains "chore: done"

  Scenario: A still-red suite with byte-identical output escalates instead of false-greening into review
    # Drives the REAL bundled unified template (not a custom .gtdrc) through
    # `gtd --entry fix-precheck`: a suite that always fails with
    # byte-identical output must never be mistaken for green just because a
    # re-run produces no diff — `build.fix`'s own `retry: {max: 3}` routes to
    # `build.health.escalate` after 3 unsuccessful fix attempts.
    Given a test project
    And the workflow
    And GTD_TESTCOMMAND is set to "sh -c 'echo boom; exit 1'"
    And a stub "claude" CLI that responds to prompts with:
      """
      case "$prompt" in
        *"the failing test output"*)
          echo x >> scratch.txt
          ;;
        *)
          echo "readme-driver test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    Given the README's minimal driver
    When I run the README driver
    Then it succeeds
    And stdout contains "The agent could not get the check to pass after repeated attempts."
    And the git log does not contain "build.health.check → build.review"

  Scenario: --entry fix-precheck on a green baseline collapses to nothing
    # A green suite is nothing to fix: the empty `gtd(human): fix-precheck`
    # entry commit and the no-op check are collapsed away rather than left as
    # permanent bookkeeping commits.
    Given a test project
    And the workflow
    And GTD_TESTCOMMAND is set to "true"
    And I record the commit count
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    Given the README's minimal driver
    When I run the README driver
    Then it succeeds
    And the commit count is unchanged
