@inmem
Feature: Manual steering-file misuse, v1-history inertness, and odd .gtd contents

  Users sometimes fight the workflow by hand. v2 narrows corruption to a
  single case: a clean `.gtd/` HEAD whose subject the machine's turn/routing
  grammar (`./Subjects.ts`) does not recognize at all matches no rest and no
  mid-chain row, so gtd hard-errors with "no precedence rule matched" rather
  than guessing. Steering-file presence checks that used to hard-error a
  hand-deleted REVIEW.md/FEEDBACK.md in v1 no longer do in v2: the routing
  subject alone (`gtd: awaiting review`, `gtd: errors`) is enough to resolve a
  rest, regardless of whether the file the phase is named after is still
  present — so those two v1 corruption scenarios now resolve cleanly instead
  (documented below as a deliberate v1→v2 behavior change). v1-taxonomy
  history (`gtd: new task`, `gtd: grilling`, `gtd: transport`, …) falls outside
  the v2 closed subject sets and is inert boundary history, never an error. A
  hand-committed stray SQUASH_MSG.md under a boundary HEAD is also inert:
  SQUASH_MSG.md is in the steering-file exclusion set the same as TODO.md/
  REVIEW.md, so its mere presence never marks the tree dirty and never
  registers as an unrecognized-HEAD corruption — the machine simply proceeds
  through its ordinary boundary/idle ladder.

  Scenario: An unrecognized clean .gtd HEAD matches no rule and hard-errors
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "chore: unrelated housekeeping"
    When I run gtd next
    Then it fails
    And stderr contains "no precedence rule matched"

  Scenario: v1 behavior change — a hand-committed REVIEW.md deletion at gtd: awaiting review no longer corrupts
    Given a test project
    And a commit "feat: work" that adds "src/work.ts" with:
      """
      export const work = 1
      """
    And a commit "gtd(agent): review" that adds "REVIEW.md" with:
      """
      # Review
      """
    And a commit "gtd: awaiting review"
    And a commit "gtd: awaiting review" that deletes "REVIEW.md"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""

  Scenario: v1 behavior change — a hand-committed FEEDBACK.md deletion at gtd: errors no longer corrupts
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds "FEEDBACK.md" with:
      """
      test failure output
      """
    And a commit "gtd: errors" that deletes "FEEDBACK.md"
    When I run gtd next
    Then it succeeds
    And stdout contains "Spawn a **fix subagent**"

  Scenario: A history full of v1-taxonomy commits with a clean tree is inert boundary history, not an error
    Given a test project
    And a commit "gtd: new task" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add calculator
      """
    And a commit "gtd: grilling" that deletes "TODO.md"
    And a commit "gtd: building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: transport"
    When I run gtd status
    Then it succeeds
    And stdout contains "Awaits: human"
    And stdout contains "State: idle"

  Scenario: A bare gtd: reviewing marker with no hash is inert v1-shaped history, not a review anchor
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: reviewing"
    When I run gtd status
    Then it succeeds
    And stdout contains "State: idle"

  Scenario: A stray hand-committed SQUASH_MSG.md under a boundary HEAD is inert, not corruption
    # SQUASH_MSG.md sits in the same steering-file exclusion set as TODO.md and
    # REVIEW.md, so its presence never marks the tree dirty and the machine
    # never even inspects it outside of the squash chain's own HEAD subjects
    # (`gtd: done` / `gtd: squash template` / `gtd(agent): squashing`) — this
    # pins that a stray, out-of-chain copy is silently ignored rather than
    # hard-erroring as unrecognized state.
    Given a test project
    And a commit "feat: work" that adds "src/work.ts" with:
      """
      export const work = 1
      """
    And a commit "chore: stray squash message" that adds "SQUASH_MSG.md" with:
      """
      feat: this was never part of a real squash chain
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "no precedence rule matched"

  Scenario: Non-package junk inside .gtd is ignored by the build loop
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/notes.txt" with:
      """
      scratch notes, not a package
      """
    And a commit "gtd: planning" that adds ".gtd/01-real/01-task.md" with:
      """
      Implement the real package.
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And stdout contains "Implement the real package."
    And stdout does not contain "notes.txt"

  @live
  Scenario: An empty .gtd directory does not crash the build loop
    Given a test project
    And a gtd config file at "." with:
      """
      testCommand: npm run test
      """
    And a commit "gtd: planning"
    And a directory ".gtd"
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
