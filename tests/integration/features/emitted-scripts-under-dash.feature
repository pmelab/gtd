@live
Feature: Emitted scripts actually run under a real POSIX shell (dash), not just bash-flavored sh

  Every script gtd emits — `gtd land`'s `required`/`optional` halves
  (`src/emit/Emit.ts`) and the outcome preamble that prints what just landed
  (`src/emit/OutcomeScript.ts`) — is POSIX `sh` now, not bash. Every other `@live`
  scenario in this suite proves that under whatever `/bin/sh` the test host
  happens to have — but on macOS `/bin/sh` IS bash running in POSIX mode,
  which still accepts bash-only syntax (`local`, `$'...'` ANSI-C quoting,
  process substitution) that a real POSIX shell rejects. Piping a script into
  `sh` there proves nothing about portability to a genuinely POSIX-only
  shell.

  This scenario points every `sh` gtd's emitted scripts resolve at real
  `dash` (via a PATH shim ahead of the test's own PATH — see `Given real
  dash runs every emitted script` in
  `tests/integration/support/steps/common.steps.ts`), then lands a steering
  step's turn, whose script also rewrites the steering file in its canonical
  form, through it.

  Prerequisite: `dash` must be on PATH (it ships at `/bin/dash` on macOS;
  install it on Debian/Ubuntu with `apt-get install dash` — most such
  images already have it, since `/bin/sh` is a symlink to it there).

  Background:
    Given a test project
    And real dash runs every emitted script

  Scenario: a steering step's landing script runs under dash
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("plan", "write the plan", { file: ".gtd/PLAN.md" })
        await human("answer", { message: "answer the plan", file: ".gtd/PLAN.md" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → plan"
    And I run the pin beat
    And a file ".gtd/PLAN.md" with:
      """
      # Plan

      ## ❔ Ship it?

      - [ ] Yes
      """
    When I run gtd land --json=script piped to sh
    Then the exit code is 0
    And the last commit subject is "gtd(agent): plan → answer"
