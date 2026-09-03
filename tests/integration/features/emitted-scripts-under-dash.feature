@live
Feature: Emitted scripts actually run under a real POSIX shell (dash), not just bash-flavored sh

  Every script gtd emits — `gtd land`'s `required`/`optional` halves
  (`src/Emit.ts`) and the outcome preamble that prints what just landed
  (`src/OutcomeScript.ts`) — is POSIX `sh` now, not bash. Every other `@live`
  scenario in this suite proves that under whatever `/bin/sh` the test host
  happens to have — but on macOS `/bin/sh` IS bash running in POSIX mode,
  which still accepts bash-only syntax (`local`, `$'...'` ANSI-C quoting,
  process substitution) that a real POSIX shell rejects. Piping a script into
  `sh` there proves nothing about portability to a genuinely POSIX-only
  shell.

  This scenario points every `sh` gtd's emitted scripts resolve at real
  `dash` (via a PATH shim ahead of the test's own PATH — see `Given real
  dash runs every emitted script` in
  `tests/integration/support/steps/common.steps.ts`), then proves the
  mode-contradiction round-trip's printf/cat/pipe machinery
  (`src/ModeContradiction.ts`'s `buildModeContradictionCheck`) parses and
  runs under `dash`, not just bash-flavored sh.

  Prerequisite: `dash` must be on PATH (it ships at `/bin/dash` on macOS;
  install it on Debian/Ubuntu with `apt-get install dash` — most such
  images already have it, since `/bin/sh` is a symlink to it there).

  Background:
    Given a test project
    And real dash runs every emitted script

  Scenario: the mode-contradiction round-trip (package 2) also runs under dash, not just bash-flavored sh
    # This scenario declares a built-in mode paired with a hostile format: —
    # the round-trip's own printf/cat/pipe machinery must parse and run under
    # a genuinely POSIX-only shell, exactly like every other emitted script
    # in this file.
    Given a gtd config file at ".gtdrc" with:
      """
      workflow:
        modes:
          review:
            format: "sed -i.bak '1s/^# Review:.*/# Not a review header/' <%= it.file %> && rm -f <%= it.file %>.bak"
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
