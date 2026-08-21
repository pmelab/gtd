@live
Feature: Emitted scripts actually run under a real POSIX shell (dash), not just bash-flavored sh

  Every script gtd emits — `gtd land`'s `required`/`optional` halves
  (`src/Emit.ts`), the review checkout window's open/close sequences
  (`src/ReviewWindow.ts`), and the outcome preamble that prints what just
  landed (`src/OutcomeScript.ts`) — is POSIX `sh` now, not bash. Every other
  `@live` scenario in this suite proves that under whatever `/bin/sh` the
  test host happens to have — but on macOS `/bin/sh` IS bash running in
  POSIX mode, which still accepts bash-only syntax (`local`, `$'...'`
  ANSI-C quoting, process substitution) that a real POSIX shell rejects.
  Piping a script into `sh` there proves nothing about portability to a
  genuinely POSIX-only shell.

  This scenario proves it for real: it points every `sh` the driver and its
  emitted scripts resolve at real `dash` (via a PATH shim ahead of the
  test's own PATH — see `Given real dash runs every emitted script` in
  `tests/integration/support/steps/common.steps.ts`), then drives the
  README's own minimal driver through a full beat that lands an agent
  turn, opens the review checkout window, closes it again on a feedback
  round, and reopens it — exercising the retry-wrapped git writes
  (`gtd_retry`), the review-window open/close sequences, and the outcome
  preamble's own printf/here-doc machinery, all under `dash`.

  Prerequisite: `dash` must be on PATH (it ships at `/bin/dash` on macOS;
  install it on Debian/Ubuntu with `apt-get install dash` — most such
  images already have it, since `/bin/sh` is a symlink to it there).

  Background:
    Given a test project
    And real dash runs every emitted script
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
                  "* **": reviewing
              reviewing:
                actor: human
                reviewWindow: true
                message: "review the change — leave a note in FEEDBACK_NOTE.md to request changes, or accept by changing nothing"
                on:
                  "A FEEDBACK_NOTE.md": revising
                  "C": done
                  "* **": done
              revising:
                actor: agent
                prompt: "Address the feedback in FEEDBACK_NOTE.md, then delete it."
                on:
                  "* **": reviewing
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
        *"Address the feedback"*)
          rm -f FEEDBACK_NOTE.md
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    And the driver pasted from README.md

  Scenario: A full beat — agent turn, review-window open, a feedback round that closes and reopens it — all under dash
    When I run the README driver
    Then it succeeds
    # `working` landed and opened the window (no prior window to close) —
    # the review-window open sequence, the gtd_retry-wrapped commit, and the
    # outcome preamble's transition report all ran under dash here.
    And the git ref "refs/worktree/gtd/review-head" exists
    And stdout contains "review the change"
    Given a file "FEEDBACK_NOTE.md" with:
      """
      handle negative numbers too
      """
    When I run the README driver
    Then it succeeds
    # The capture landed the feedback note (closing the window), the agent's
    # "revising" turn deleted it and landed again (reopening the window) —
    # both the close and the open sequence ran under dash in this one run.
    # HEAD is rewound to the review base while the window is open, so the
    # intermediate commits aren't visible via plain `git log` yet, and won't
    # be even once the window closes — the finale below SQUASHES them away,
    # exactly like the bundled template's own `done`/`commit:` state does.
    And the git ref "refs/worktree/gtd/review-head" exists
    And "FEEDBACK_NOTE.md" does not exist
    And the git status does not contain "FEEDBACK_NOTE.md"
    # Re-running with nothing changed is itself the sign-off decision (the
    # "C" edge above) — this beat's own land closes the window one last time
    # and squashes the whole process into one commit, all under dash.
    When I run the README driver
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" does not exist
    And the git log contains "chore: calculator done"
    And "src/calc.ts" exists
    And "FEEDBACK_NOTE.md" does not exist

  Scenario: the mode-contradiction round-trip (package 2) also runs under dash, not just bash-flavored sh
    # This scenario replaces the Background's own .gtdrc with one declaring a
    # built-in mode paired with a hostile format: — the round-trip's own
    # printf/cat/pipe machinery (src/ModeContradiction.ts's
    # buildModeContradictionCheck) must parse and run under a genuinely
    # POSIX-only shell, exactly like every other emitted script in this file.
    Given a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          review:
            format: "sed -i.bak 's/^- \\[/* [/' <%= it.file %> && rm -f <%= it.file %>.bak"
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                file: REVIEW.md
                mode: review
                prompt: "review"
                on:
                  "* **": idle
      """
    And an empty commit "gtd(human): reviewing"
    When I run gtd with args "validate"
    Then it fails
    And stderr contains "CONFIGURATION BUG"
    And stderr contains "Do NOT edit the steering file"
