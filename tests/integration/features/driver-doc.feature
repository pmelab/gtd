@live
Feature: docs/driver.md's minimal driver — doc-tested against the loop protocol

  docs/driver.md's "Writing your own driver" section ends in "A complete
  minimal driver": a ~40-line paste small enough to own outright, and the
  loop's ONLY shipped driver — gtd itself is a pure planner with nothing to
  execute. Nothing else runs the paste, so it can rot silently. These
  scenarios extract the fenced block VERBATIM (see
  `tests/integration/helpers/driver-doc.ts`) and run it as the driver
  under test. Only the wiring is smoke-tested here — chained turns, the
  capture beat, the self-validation gate, cost recording and the
  context-limit stop; the protocol's branches are
  covered in-memory. A real `claude` CLI is never invoked: a
  `claude` shim on $PATH translates the paste's own argv (-p, --session-id,
  --resume, --model, --settings, --dangerously-skip-permissions) and the prompt piped to
  it on stdin into the stub agent's env. The driver is spawned with only
  $PATH (the shim dir first) and $HOME —
  no $GTD_* var, no test-harness leak — which is itself the
  copy-paste-complete proof. Turn/transition reporting is not asserted here
  beyond what the emitted scripts print themselves
  (`src/emit/OutcomeScript.ts`).

  Scenario: Chains an agent turn through a check turn and halts back at the human gate
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, run } from "@pmelab/gtd/flows"

      const red = (): boolean => changes(".gtd/FEEDBACK.md").some((c) => c.status !== "deleted")

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        do {
          await agent(
            "working",
            "Build the package described below: write src/calc.ts exporting add(a, b).",
          )
          await run(
            "checking",
            `if [ -f src/calc.ts ] && grep -q add src/calc.ts; then rm -f .gtd/FEEDBACK.md; else mkdir -p .gtd && echo "missing add" > .gtd/FEEDBACK.md; fi`,
          )
        } while (red())
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
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
    And the driver pasted from docs/driver.md
    When I run the pasted script
    Then it succeeds
    And stdout contains "write NOTE.md to start a process"
    And the last commit subject is "gtd(check): checking → idle"
    And "src/calc.ts" exists

  Scenario: Captures the human's pending edit at the opening gate, so the human only runs the driver
    # The machine rests at the initial human gate `idle` (no gtd commit — the
    # test project's "chore: initial commit" resolves to the initial state)
    # with an uncommitted NOTE.md sketch. The human never runs `gtd land`: the
    # loop's first beat is `kind: "capture"` (a message rest with a dirty
    # tree), landed immediately (idle's `* **` -> working), then it drives
    # working -> checking -> done on its own.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, run } from "@pmelab/gtd/flows"

      const red = (): boolean => changes(".gtd/FEEDBACK.md").some((c) => c.status !== "deleted")

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        do {
          await agent(
            "working",
            "Build the package described below: write src/calc.ts exporting add(a, b).",
          )
          await run(
            "checking",
            `if [ -f src/calc.ts ] && grep -q add src/calc.ts; then rm -f .gtd/FEEDBACK.md; else mkdir -p .gtd && echo "missing add" > .gtd/FEEDBACK.md; fi`,
          )
        } while (red())
      }
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
    And the driver pasted from docs/driver.md
    When I run the pasted script
    Then it succeeds
    And "src/calc.ts" exists
    And the last commit subject is "gtd(check): checking → idle"

  Scenario: Runs the self-validation gate after a producing agent turn and re-prompts until the steering file is well-formed
    # `planning` declares file:/mode: (.gtd/PLAN.md as `qa`), so its output has
    # a checkable format. The paste's `.validate` field is embedded in the
    # BEAT it reads before the agent's turn runs — so the file must already
    # exist at that point for the field to be populated at all (`gtd next
    # --json` omits it for a file the working tree doesn't have yet, exactly
    # like plain `gtd validate` degrades) — this is why a placeholder
    # .gtd/PLAN.md is seeded below, standing in for a prior draft. The stub
    # then OVERWRITES it with a MALFORMED plan first; the paste's embedded
    # validate script fails, and it re-prompts the SAME session with the
    # validator's own findings (verbatim — `$out` IS the fix prompt), on which
    # the stub writes a valid plan — only then does the paste step, landing
    # the commit that enters idle.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("planning", "Write .gtd/PLAN.md with the plan.", {
          file: ".gtd/PLAN.md",
          mode: "qa",
        })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → planning"
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
    And the driver pasted from docs/driver.md
    When I run the pasted script
    Then it succeeds
    And the log file contains "AGENT: first draft"
    And the log file contains "AGENT: fixing the plan"
    And the last commit subject is "gtd(agent): planning → idle"
    # The fix re-prompt is the validate script's own output verbatim — not the
    # state's own prompt text prefixed onto it.
    And the log file does not contain "Write .gtd/PLAN.md with the plan."

  Scenario: Records each turn's cost on the landing, tagged with the model the hint resolved to
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "Write DONE.md.", { model: "smart" })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    And an environment variable "GTD_LOOP_MODEL_SMART" set to "opus"
    And a stub agent script that responds to prompts with:
      """
      [ "$GTD_LOOP_MODEL" = opus ] || { echo "model was $GTD_LOOP_MODEL" >&2; exit 1; }
      echo done > DONE.md
      echo '{"type":"result","is_error":false,"result":"done","total_cost_usd":0.25}'
      """
    And the driver pasted from docs/driver.md
    When I run the pasted script
    Then it succeeds
    And the last commit subject is "gtd(agent): working → idle"
    And the last commit body contains "Gtd-Cost: 0.25 opus"

  Scenario: Stops without landing when gtd context-hook stops the turn at its hard limit
    # The stub plays Claude Code: it runs the hook command the paste handed
    # it through --settings with a PreCompact event, which always stops.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "Write DONE.md.", { context: { soft: 0.5, hard: 0.6 } })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    And a stub agent script that responds to prompts with:
      """
      hook="$(printf '%s' "$GTD_LOOP_SETTINGS" | sed -n 's/.*"command":"\([^"]*\)".*/\1/p')"
      echo "HOOK: $hook"
      echo done > DONE.md
      echo '{"hook_event_name":"PreCompact"}' | sh -c "$hook"
      echo '{"type":"result","is_error":false,"terminal_reason":"hook_stopped"}'
      """
    And the driver pasted from docs/driver.md
    When I run the pasted script
    Then it fails
    And stderr contains "gtd: context limit: the context is about to be compacted"
    And the log file contains "HOOK: gtd context-hook --soft 0.5 --hard 0.6"
    And the last commit subject is "gtd(human): idle → working"

  Scenario: Lands nothing, and retries nothing, when the agent's envelope reports an error at exit 0
    # A second call would succeed: the paste must not make one, since the
    # failed turn ran and the session flag was not the problem.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("working", "Write DONE.md.")
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → working"
    And a stub agent script that responds to prompts with:
      """
      if [ -f .git/turned ]; then
        echo whole > DONE.md
        echo '{"type":"result","is_error":false}'
        exit 0
      fi
      touch .git/turned
      echo half > DONE.md
      echo '{"type":"result","subtype":"error_max_turns","is_error":true}'
      """
    And the driver pasted from docs/driver.md
    When I run the pasted script
    Then it fails
    And the last commit subject is "gtd(human): idle → working"

  Scenario: Hands an opening judge gate to the human, landing nothing, when the judge fails
    # No provider is configured, so `gtd judge run` asks `claude`, and the
    # stub fails that call.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, judge } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await judge("gate", {
          questions: [{ id: "q1", primitive: "noul", instructions: "i", criteria: "c" }],
          evidence: {},
          message: "judge me",
        })
        await human("done", { message: "all done" })
      }
      """
    And a file "NOTE.md" with:
      """
      Build a calculator.
      """
    And gtd lands "gtd(human): idle → gate"
    And an environment variable "XDG_CONFIG_HOME" set to "/nonexistent-gtd-config"
    And a stub agent script that responds to prompts with:
      """
      echo "no login" >&2
      exit 1
      """
    And the driver pasted from docs/driver.md
    When I run the pasted script
    Then it succeeds
    And stdout contains "judge me"
    And the last commit subject is "gtd(human): idle → gate"
