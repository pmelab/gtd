Feature: Full lifecycle journeys — many gtd runs across every state seam

  Per-state scenarios pin each state in isolation; these journeys chain many
  gtd invocations through complete lifecycles, simulating the agent between
  runs (developing the plan, decomposing packages, writing code, recording
  review verdicts) and asserting the exact commit-subject sequence at the end.
  They guard the seams between states that isolated scenarios cannot see.

  Scenario: Happy path — raw input to approved review and stable idle
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a file "src/input.ts" with:
      """
      export const rawIdea = () => 42
      """
    # Run 1: New Feature captures the input, reverts it, seeds TODO.md;
    # Grilling commits the seed and prompts.
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: new task"
    And the last commit subject is "gtd: grilling"
    And the file "src/input.ts" does not exist
    And the file "TODO.md" contains "src/input.ts"
    And stdout contains "## Task: Grill the plan in `TODO.md`"
    # The agent develops the plan and leaves an open question.
    When "TODO.md" is modified to:
      """
      # Plan

      Implement a calculator.

      ## Which operations?

      <!-- user answers here -->
      """
    # Run 2: open marker → commit and STOP for the user.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And stdout contains "Open questions await the user"
    # The user answers inline and the plan converges.
    When "TODO.md" is modified to:
      """
      # Plan

      Implement a calculator with add only, in src/calc.ts.

      no open questions — run gtd to plan
      """
    # Run 3: pending plan edits → grilling iterates.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And stdout contains "### Develop the plan"
    # Run 4: clean converged plan → Grilled, prompts decomposition.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And stdout contains "## Task: Decompose the plan into work packages"
    # The agent decomposes into one package.
    When a file ".gtd/01-calc/01-add.md" with:
      """
      Implement add() in src/calc.ts.
      """
    # Run 5: modified .gtd → Planning commits it.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: planning"
    # Run 6: clean .gtd → Building deletes TODO.md and prompts the build.
    When I run gtd
    Then it succeeds
    And the file "TODO.md" does not exist
    And stdout contains "## Task: Build one work package"
    And stdout contains "Implement add() in src/calc.ts."
    # The builder writes the code.
    When a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    # Run 7: Testing commits gtd: building, gate is green → Agentic Review.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: building"
    And stdout contains "## Task: Agentic review of the built package"
    # The review agent approves with an empty FEEDBACK.md.
    When an empty file "FEEDBACK.md"
    # Run 8: Close package, .gtd gone → Clean prompts the human review.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And the file ".gtd" does not exist
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/calc.ts"
    And stdout does not contain "a/TODO.md"
    # The review agent writes REVIEW.md.
    When a file "REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1
      """
    # Run 9: Await Review commits it and stops for the human.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: awaiting review"
    And stdout contains "## Task: Await the user's review"
    # Run 10: the human approves by running gtd with no edits → Done → Squashing.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: done"
    And the file "REVIEW.md" does not exist
    And stdout contains "## Task: Squash all `gtd: *` commits into one conventional-commits message"
    And stdout contains "git reset --soft"
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: add .gtdrc
      gtd: new task
      gtd: grilling
      gtd: grilling
      gtd: grilling
      gtd: grilled
      gtd: planning
      gtd: planning
      gtd: building
      gtd: package done
      gtd: awaiting review
      gtd: done
      """

  Scenario: Feedback journey — annotations rebuild within the open process
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add greeter
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: building" that adds "src/greet.ts" with:
      """
      export const greet = (name: string) => `Hello, ${name}`
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      ## Add greeter

      - [ ] ./src/greet.ts#1
      """
    # The reviewer asks for more instead of approving.
    When "REVIEW.md" is modified to:
      """
      # Review

      ## Add greeter

      - [ ] ./src/greet.ts#1

      Please also add a farewell function.
      """
    # Run 1: Accept Review captures the feedback and re-enters grilling.
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: review feedback"
    And the last commit subject is "gtd: grilling"
    And the file "REVIEW.md" does not exist
    And the file "TODO.md" contains "farewell"
    # The agent develops the follow-up plan to convergence.
    When "TODO.md" is modified to:
      """
      # Plan

      Add farewell() in src/farewell.ts.

      no open questions — run gtd to plan
      """
    When I run gtd
    Then it succeeds
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    When a file ".gtd/01-farewell/01-task.md" with:
      """
      Implement farewell() in src/farewell.ts.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: planning"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Build one work package"
    When a file "src/farewell.ts" with:
      """
      export const farewell = (name: string) => `Goodbye, ${name}`
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: building"
    When an empty file "FEEDBACK.md"
    # The follow-up review covers only the new work — and the process is still
    # open: no `gtd: done` was ever committed on the feedback path.
    When I run gtd
    Then it succeeds
    And the git log does not contain "gtd: done"
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/farewell.ts"
    And stdout does not contain "src/greet.ts"
    And stdout does not contain "a/REVIEW.md"
    And stdout does not contain "a/TODO.md"
    When a file "REVIEW.md" with:
      """
      # Review

      ## Add farewell

      - [ ] ./src/farewell.ts#1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: awaiting review"
    # The human approves the follow-up → the process finally closes → Squashing.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: done"
    And stdout contains "## Task: Squash all `gtd: *` commits into one conventional-commits message"
    And stdout contains "git reset --soft"

  Scenario: Escalation journey — cap, human resume, fresh budget
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      fixAttemptCap: 2
      """
    And a commit "chore: gate" that adds "gate.sh" with:
      """
      test -f green.marker
      """
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add helper
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: planning" that adds ".gtd/01-helper/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "src/helper.ts" with:
      """
      export const helper = () => 1
      """
    # Run 1: red gate below the cap → FEEDBACK.md → Fixing commits its removal.
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: errors"
    And the last commit subject is "gtd: fixing"
    And stdout contains "## Task: Fix the package against `FEEDBACK.md`"
    # Run 2: the fixer produced no change — re-test is still red, budget 1/2.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: fixing"
    And stdout contains "## Task: Fix the package against `FEEDBACK.md`"
    # Run 3: re-test red at the cap → ERRORS.md → Escalate STOP.
    When I run gtd
    Then it succeeds
    And the file "ERRORS.md" exists
    And stdout contains "## Task: Escalate — the test gate is stuck"
    # The human fixes the underlying problem and removes ERRORS.md.
    Given a deleted committed file "ERRORS.md"
    And a file "green.marker" with:
      """
      green
      """
    # Run 4: the budget is reset — re-test goes green, no re-escalation.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: building"
    And the file "ERRORS.md" does not exist
    And stdout contains "## Task: Agentic review of the built package"

  Scenario: Two-package journey — counters reset at the package seam
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      """
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] two helpers
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "gtd: planning" that adds ".gtd/01-one/01-task.md" with:
      """
      Implement the first helper.
      """
    And a commit "gtd: planning" that adds ".gtd/02-two/01-task.md" with:
      """
      Implement the second helper.
      """
    # Run 1: Building selects the first package.
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Build one work package"
    And stdout contains "Implement the first helper."
    When a file "src/one.ts" with:
      """
      export const one = 1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: building"
    When an empty file "FEEDBACK.md"
    # Close the first package → Building immediately offers the second.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: package done"
    And the file ".gtd/01-one/01-task.md" does not exist
    And the file ".gtd/02-two/01-task.md" exists
    And stdout contains "Implement the second helper."
    When a file "src/two.ts" with:
      """
      export const two = 2
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: building"
    When an empty file "FEEDBACK.md"
    # Close the last package → Clean reviews the whole task, plumbing-free.
    When I run gtd
    Then it succeeds
    And the file ".gtd" does not exist
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/one.ts"
    And stdout contains "src/two.ts"
    And stdout does not contain "a/.gtd"

  Scenario: Multi-review branch — approvals gate, new commits re-open
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: first slice" that adds "src/first.ts" with:
      """
      export const first = 1
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/first.ts#1
      """
    # Run 1: approve → done → idle; the gate keeps it there.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: done"
    And stdout contains "## Task: Nothing to do"
    # New work lands after the approval — the whole-branch review re-opens.
    Given a commit "feat: second slice" that adds "src/second.ts" with:
      """
      export const second = 2
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/first.ts"
    And stdout contains "src/second.ts"
    When a file "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/first.ts#1
      - [ ] ./src/second.ts#1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: awaiting review"
    # Run: approve the second review → done → idle again.
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: done"
    And stdout contains "## Task: Nothing to do"
