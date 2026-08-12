@live
Feature: The README's minimal driver — doc-tested against the loop protocol

  README.md's "Writing your own driver" section ends in "A complete minimal
  driver": a ~40-line paste small enough to own outright, and the loop's
  ONLY shipped driver — gtd itself is a pure planner with nothing to
  execute. Nothing else runs the paste, so it can rot silently. These
  scenarios extract the fenced block VERBATIM (see
  `tests/integration/helpers/readme-driver.ts`) and run it as the driver
  under test: chained turns, the capture beat, settling vs. stalling, the
  self-validation gate and its fix cap, check-script log redirection, and
  session continuity across laps. A real `claude` CLI is never invoked: a
  `claude` shim on $PATH translates the paste's own argv (-p, --session-id,
  --resume, --model, --dangerously-skip-permissions) into the stub agent's
  env. The driver is spawned with only $PATH (the shim dir first) and $HOME —
  no $GTD_* var, no test-harness leak — which is itself the
  copy-paste-complete proof. Turn/transition reporting is not asserted here
  beyond what the emitted scripts print themselves
  (`src/OutcomeScript.ts`).

  Scenario: Chains an agent turn through a check turn and halts back at the human gate
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
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And stdout contains "write NOTE.md to start a process"
    And the git log contains "chore: calculator done"
    And "src/calc.ts" exists

  Scenario: A check script's own cleanup mechanic (a sole swept deletion) advances the process instead of stalling
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
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And stdout contains "sign off to finish"
    And the last commit subject is "gtd(check): checking → reviewing"
    And "leaked.md" does not exist
    And "src/calc.ts" exists

  Scenario: Captures the human's pending edit at the opening gate, so the human only runs the driver
    # The machine rests at the initial human gate `idle` (no gtd commit — the
    # test project's "chore: initial commit" resolves to the initial state)
    # with an uncommitted NOTE.md sketch. The human never runs `gtd land`: the
    # loop's first beat is `kind: "capture"` (a message rest with a dirty
    # tree), landed immediately (idle's `* **` -> working), then it drives
    # working -> checking -> done on its own.
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
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And "src/calc.ts" exists
    And the git log contains "chore: calculator done"

  Scenario: A mid-process restart resumes driving instead of failing at the opening capture
    # A mid-process restart can leave the machine resting at a message-kind
    # gate with a CLEAN tree (the process's own commit already landed it —
    # nothing pending). That is a `kind: "message"` beat, not a `capture`, so
    # the loop halts cleanly at its own message handling instead of authoring
    # an attempt — there is no opening move to fail.
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
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And stdout contains "heads up: work is starting"

  Scenario: Accepts a gate by inaction on the opening beat, driving on past it
    # `await` routes its "C" (clean-tree) pattern onward, so changing nothing
    # there IS the decision "accept the plan". The machine already rests there
    # with a clean tree, so the driver's opening beat is `kind: "message"` —
    # indistinguishable from a gate nobody has read. Re-running the driver is
    # what makes it the human's: the opening beat lands, "C" matches, and the
    # run drives on to the finale instead of reprinting the gate forever.
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
                prompt: "Write PLAN.md describing the build."
                on:
                  "* **": await
              await:
                actor: human
                message: "read PLAN.md — accept it by changing nothing, or edit it to revise"
                on:
                  "C": done
                  "* **": planning
              done:
                commit: "chore: planned"
      """
    And a commit "gtd(agent): await" that adds "PLAN.md" with:
      """
      Build a calculator.
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the git log contains "chore: planned"
    And stdout does not contain "read PLAN.md"

  Scenario: Shows the same gate instead of accepting it when the run itself produced it
    # The regression guard for the scenario above. Here the run STARTS at the
    # opening `idle` capture and reaches `await` on its third beat — a gate the
    # driver just produced and the human has not read. Landing it would accept
    # a plan nobody reviewed, collapsing the gate entirely, so the driver must
    # print it and stop. Same workflow, same gate, opposite outcome: the only
    # difference is which beat reaches it.
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
                prompt: "Write PLAN.md describing the build."
                on:
                  "* **": await
              await:
                actor: human
                message: "read PLAN.md — accept it by changing nothing, or edit it to revise"
                on:
                  "C": done
                  "* **": planning
              done:
                commit: "chore: planned"
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      case "$GTD_LOOP_PROMPT" in
        *"Write PLAN.md"*)
          echo "step one: build it" > PLAN.md
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And stdout contains "read PLAN.md"
    And the git log does not contain "chore: planned"

  Scenario: Settles instead of looping forever when a script rest makes no progress
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
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And stdout does not contain "write NOTE.md"

  Scenario: Stops instead of spinning when the agent's turn makes no progress
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
    And a stub agent script that responds to prompts with:
      """
      : # does nothing — the build prompt is never acted on
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it fails
    And stderr contains "stalled at \"working\""

  Scenario: A retry cap redirects a would-be stall to a human gate instead of halting
    # Same shape as the stall above, but `working` declares `retry: {max: 1}`
    # redirecting to `blocked`. The commit below already counts as `working`'s
    # first entry, so the next entry attempt — the empty attempt the agent's
    # no-op turn would otherwise land — exceeds the cap and is redirected to
    # `blocked` instead: one wasted dispatch, then an ordinary human hand-off,
    # not a non-zero halt.
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
                retry:
                  max: 1
                  otherwise: blocked
                prompt: "Build the package described below: write src/calc.ts exporting add(a, b)."
                on:
                  "* **": checking
              checking:
                actor: check
                script: "true"
                on:
                  "A .gtd/FEEDBACK.md": working
              blocked:
                actor: human
                message: "stuck — the agent made no progress"
                on:
                  "* **": done
              done:
                commit: "chore: done"
      """
    And a commit "gtd(agent): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      : # does nothing — the build prompt is never acted on
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the last commit subject is "gtd(agent): working → blocked"
    And stdout contains "stuck — the agent made no progress"
    And stderr does not contain "stalled at"

  Scenario: A dirty human gate reached mid-run is a capture beat — landed outright, never halting the driver
    # The loop's own first `next --json` read finds "confirm" resting with
    # REVIEW.md already written — a message rest with a
    # dirty tree is `kind: "capture"` — and the loop's `capture) ;;` branch
    # falls straight through to landing it as reviewer, with no display and no
    # halt, continuing on to the next gate.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: confirm
            states:
              confirm:
                actor: reviewer
                message: "confirm before continuing"
                on:
                  "A REVIEW.md": done
              done:
                actor: human
                message: "all done"
      """
    And a file "REVIEW.md" with:
      """
      looks good
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the last commit subject is "gtd(reviewer): confirm → done"
    And stdout contains "all done"

  Scenario: Runs the self-validation gate after a producing agent turn and re-prompts until the steering file is well-formed
    # `planning` declares file:/mode: (.gtd/PLAN.md as `qa`), so its output has
    # a checkable format. The paste's `.validate` field is embedded in the
    # BEAT it reads before the agent's turn runs — so the file must already
    # exist at that point for the field to be populated at all (`gtd next
    # --json` omits it for a file the working tree doesn't have yet, exactly
    # like `gtd validate --json` degrades) — this is why a placeholder
    # .gtd/PLAN.md is seeded below, standing in for a prior draft. The stub
    # then OVERWRITES it with a MALFORMED plan first; the paste's embedded
    # validate script fails, and it re-prompts the SAME session with the
    # validator's own findings (verbatim — `$out` IS the fix prompt), on which
    # the stub writes a valid plan — only then does the paste step, squashing
    # to done.
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
    And a file ".gtd/PLAN.md" with:
      """
      a prior draft, about to be overwritten
      """
    And a stub agent script that responds to prompts with:
      """
      mkdir -p .gtd
      case "$GTD_LOOP_PROMPT" in
        *"does not pass"*)
          echo "AGENT: fixing the plan"
          echo "FIX PROMPT WAS: $GTD_LOOP_PROMPT"
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
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the log file contains "AGENT: first draft"
    And the log file contains "AGENT: fixing the plan"
    And the git log contains "chore: planned"
    # The fix re-prompt is the validate script's own output verbatim — not the
    # state's own prompt text prefixed onto it.
    And the log file does not contain "Write .gtd/PLAN.md with the plan."

  Scenario: Stops instead of stepping when a steering file still fails validation after 3 fix attempts
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
    # A placeholder — needed so the paste's embedded `.validate` field (read
    # from the beat fetched BEFORE the agent's turn) is populated at all; see
    # the comment on the scenario above.
    And a file ".gtd/PLAN.md" with:
      """
      a prior draft, about to be overwritten
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
    And the driver pasted from README.md
    When I run the README driver
    Then it fails
    And stderr contains "has no question text"
    And the git log does not contain "chore: planned"

  Scenario: Redirects the check script's own output to the log file instead of the terminal
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
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And stdout does not contain "CHECK: verifying the tree"
    And the log file contains "CHECK: verifying the tree"

  Scenario: A check script that exits non-zero still lets the pattern decide the outcome
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: checking
            states:
              checking:
                actor: check
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
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the log file contains "CHECK BOOM"
    And the last commit subject is "gtd(check): checking → reviewing"
    And stdout contains "sign off"

  Scenario: A failing agent CLI stops the run instead of stepping past it
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
    And a stub agent script that responds to prompts with:
      """
      echo "BOOM: agent exploded" >&2
      exit 3
      """
    And the driver pasted from README.md
    And I record the commit count
    When I run the README driver
    Then it fails
    And the log file contains "BOOM: agent exploded"
    And the commit count is unchanged

  Scenario: Carries session continuity across a fix/check retry loop, resuming within a scope
    # Memory scope is COMPUTED from machine-instance membership, not an
    # authored label — the fix/check retry loop is its OWN machine instance
    # (`fixLoop`) so its `fixing` state shares one scope (and so one agent
    # session) across repeated visits, distinct from `working`'s (root-scope)
    # session. The stub echoes the session env the paste's `claude` lines map
    # `.session.id`/`.session.resume` onto (via the `claude` shim), so the log proves:
    # a fresh id for root's one-off turn, a fresh id for fix's first turn, and
    # THAT SAME fix-scope id resumed on fix's second turn. The check's attempt
    # counter lives in .git (never the work tree), forcing exactly two fix laps.
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
                prompt: "Create src/fix.ts for the initial build."
                on:
                  "* **": fix.checking
              fix:
                machine: fixLoop
                with:
                  onGreen: done
              done:
                commit: "chore: fixed"
          fixLoop:
            params: [onGreen]
            entry: checking
            states:
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
                  "D .gtd/FEEDBACK.md": "$onGreen"
                  "C": "$onGreen"
              fixing:
                actor: agent
                prompt: "Fix the failing check."
                on:
                  "* **": checking
      """
    And a commit "gtd(agent): working" that adds "NOTE.md" with:
      """
      Build a calculator.
      """
    And a stub agent script that responds to prompts with:
      """
      echo "AGENT SESSION=${GTD_LOOP_SESSION_ID} RESUME=${GTD_LOOP_MEMORY_RESUME}"
      case "$GTD_LOOP_PROMPT" in
        *"initial build"*)
          mkdir -p src
          echo 'export const x = 1' > src/fix.ts
          ;;
        *"Fix the failing"*)
          echo "// touched" >> src/fix.ts
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the log file matches "AGENT SESSION=[0-9a-f-]{36} RESUME=0" 2 times
    And the log file matches "AGENT SESSION=[0-9a-f-]{36} RESUME=1" 1 times
    And the log file matches "SESSION=([0-9a-f-]{36}) RESUME=0[\s\S]*SESSION=\1 RESUME=1"
    And stdout contains "write NOTE.md to start a process"

  Scenario: A scope's session survives an interleaved turn in a nested, different scope
    # `build.building` (scope "build") routes into a NESTED child machine's
    # own agent turn, `build.review.reviewing` (scope "build.review" — a true
    # dotted DESCENDANT of "build"), before returning to `build.building2`,
    # still scope "build". The FIRST build turn's session id must be the one
    # that resumes on the SECOND build turn — not the review turn's — even
    # though the review turn ran in between. The anchored backreference below
    # pins the id captured from the very FIRST log line (the first build
    # turn, deterministically first since nothing else logs before it), so a
    # regression where the review turn's id wrongly carried over would fail
    # this specific assertion, not just "some earlier id resumed".
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
                  "* **": build.building
              build:
                machine: buildLoop
                with:
                  onGreen: done
              done:
                commit: "chore: done"
          buildLoop:
            params: [onGreen]
            entry: building
            states:
              building:
                actor: agent
                prompt: "first build turn"
                on:
                  "* **": review.reviewing
              review:
                machine: reviewChild
                with:
                  onDone: building2
              building2:
                actor: agent
                prompt: "second build turn, revisits the build scope"
                on:
                  "* **": "$onGreen"
          reviewChild:
            params: [onDone]
            entry: reviewing
            states:
              reviewing:
                actor: agent
                prompt: "review turn, a nested child scope"
                on:
                  "* **": "$onDone"
      """
    And a commit "gtd(human): build.building" that adds "NOTE.md" with:
      """
      Build a thing.
      """
    And a stub agent script that responds to prompts with:
      """
      echo "AGENT SESSION=${GTD_LOOP_SESSION_ID} RESUME=${GTD_LOOP_MEMORY_RESUME}"
      mkdir -p src
      case "$GTD_LOOP_PROMPT" in
        *"first build turn"*)
          echo 'export const x = 1' > src/thing.ts
          ;;
        *"review turn"*)
          echo "// reviewed" >> src/thing.ts
          ;;
        *"second build turn"*)
          echo "// finished" >> src/thing.ts
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the log file matches "AGENT SESSION=[0-9a-f-]{36} RESUME=0" 2 times
    And the log file matches "AGENT SESSION=[0-9a-f-]{36} RESUME=1" 1 times
    And the log file matches "^AGENT SESSION=([0-9a-f-]{36}) RESUME=0[\s\S]*AGENT SESSION=\1 RESUME=1"
    And stdout contains "write NOTE.md to start a process"

  Scenario: A refused --session-id (the crash edge's symptom) recovers via the driver's own || fallback
    # The crash edge src/Sessions.ts documents: an agent turn that mints a
    # session but lands no commit (a crash, a killed driver) re-derives the
    # SAME id with resume:false on the next lap, so `claude --session-id`
    # hits "id already in use" the second time around — `resume` is a HINT,
    # not a contract, so the driver's own `||` falls back to `--resume` on
    # that SAME id instead of wedging. The stub simulates exactly that
    # symptom directly: it refuses every `--session-id` call (as if this
    # fresh scope-run's id had already been registered by an earlier, now-gone
    # attempt) and only accepts `--resume` — proving the fallback recovers
    # within the very first beat, with no driver restart needed.
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
    And a stub agent script that responds to prompts with:
      """
      echo "AGENT SESSION=${GTD_LOOP_SESSION_ID} RESUME=${GTD_LOOP_MEMORY_RESUME}"
      if [ "$GTD_LOOP_MEMORY_RESUME" = "0" ]; then
        echo "gtd-loop test stub: session id already in use" >&2
        exit 1
      fi
      mkdir -p src
      echo 'export const add = (a, b) => a + b' > src/calc.ts
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the log file contains "gtd-loop test stub: session id already in use"
    And "src/calc.ts" exists
    And the git log contains "chore: calculator done"
    And the log file matches "AGENT SESSION=([0-9a-f-]{36}) RESUME=0[\s\S]*AGENT SESSION=\1 RESUME=1"

  Scenario: A refused --resume (retention expired) recovers via the driver's own || fallback
    # The inverse of the scenario above: `session.resume` is hinted true (this
    # is the SAME scope's second visit to `working`, after the check loop
    # below sends it back once), but the remembered agent session is gone —
    # retention expired, `~/.claude/projects` wiped — so `claude --resume`
    # fails and the driver's own `||` falls back to `--session-id` on that
    # SAME id instead of wedging. The stub simulates that symptom directly: it
    # refuses every `--resume` call and only accepts `--session-id`, and
    # deliberately writes an incomplete build on its first (`RESUME=0`) turn so
    # a second `working` turn happens at all — that second turn is the one
    # that carries `resume: true` and exercises the fallback.
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
      echo "AGENT SESSION=${GTD_LOOP_SESSION_ID} RESUME=${GTD_LOOP_MEMORY_RESUME}"
      if [ "$GTD_LOOP_MEMORY_RESUME" = "1" ]; then
        echo "gtd-loop test stub: no conversation found with session id" >&2
        exit 1
      fi
      mkdir -p src
      if [ -f .git/testmarker ]; then
        echo 'export const add = (a, b) => a + b' > src/calc.ts
      else
        echo 1 > .git/testmarker
        echo 'export const subtract = (a, b) => a - b' > src/calc.ts
      fi
      """
    And the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the log file contains "gtd-loop test stub: no conversation found with session id"
    And "src/calc.ts" exists
    And the git log contains "chore: calculator done"
    And the log file matches "AGENT SESSION=([0-9a-f-]{36}) RESUME=0[\s\S]*AGENT SESSION=\1 RESUME=1[\s\S]*AGENT SESSION=\1 RESUME=0"

  Scenario: A still-red suite with byte-identical output escalates instead of false-greening into review
    # Drives the REAL bundled unified template (not a custom .gtdrc) through
    # `gtd --entry fix-precheck`: a suite that always fails with
    # byte-identical output must never be mistaken for green just because a
    # re-run produces no diff — `build.fix`'s own `retry: {max: 3}` routes to
    # `build.health.escalate` after 3 unsuccessful fix attempts.
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
          echo "readme-driver test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    Given the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And stdout contains "The agent could not get the check to pass after repeated attempts."
    And the git log does not contain "build.health.check → build.review"

  Scenario: --entry fix-precheck on a green baseline collapses to nothing
    # A green suite is nothing to fix: the empty `gtd(human): fix-precheck`
    # entry commit and the no-op check are collapsed away rather than left as
    # permanent bookkeeping commits — and the collapse itself reports
    # `settled`, so the driver exits 0 here rather than at a message rest.
    Given a test project
    And the workflow
    And GTD_TESTCOMMAND is set to "true"
    And I record the commit count
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    Given the driver pasted from README.md
    When I run the README driver
    Then it succeeds
    And the commit count is unchanged
