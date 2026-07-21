@live
Feature: Full lifecycle journeys — the step-first two-beat loop end to end

  Per-state scenarios pin each state in isolation; these journeys chain many
  `gtd step human` / `gtd step agent` / `gtd next` invocations through complete
  lifecycles, simulating the agent between turns (developing the plan,
  decomposing packages, writing code, recording review verdicts) and asserting
  the exact commit-subject sequence at the end. They guard the seams between
  states that isolated scenarios cannot see.

  The loop protocol emulated here is the step-first two-beat: `gtd step agent`
  then `gtd next`; while `actor` is "agent" the agent beat repeats (acting on
  the prompt when one is present, or straight back to `gtd step agent` at a
  pending checkpoint); when it is "human" the human owns the next move and a
  human beat (`gtd step human`, with edits beforehand) runs instead.

  Scenario: Happy path — squash off, agenticReview off, entry to gtd: done and a stable rest
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      squash: false
      learning: false
      """
    And a file "src/input.ts" with:
      """
      export const rawIdea = () => 42
      """
    # Entry: dirty boundary tree, human turn.
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And the file "src/input.ts" exists
    # gtd next hands the agent the human's turn diff.
    When I run gtd next
    Then it succeeds
    And stdout contains "src/input.ts"
    And stdout contains "Finish your turn by running `gtd step agent`."
    # The agent develops the plan to convergence and accepts defaults.
    When a file ".gtd/TODO.md" with:
      """
      # Plan

      Implement a calculator with add only, in src/calc.ts.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling"
    # A clean human step accepts (empty turn) and converges to gtd: architecting,
    # seeding ARCHITECTURE.md from the converged plan and removing TODO.md.
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd: architecting"
    And stdout contains "state: architecting"
    And the file ".gtd/TODO.md" does not exist
    And the file ".gtd/ARCHITECTURE.md" exists
    When I run gtd next
    Then it succeeds
    And stdout contains "Develop it into a concrete"
    # The agent develops the architecture to convergence and accepts defaults.
    When a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Implement add() as a plain function export in src/calc.ts.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): architecting"
    # A clean human step accepts (empty turn) and converges to gtd: grilled.
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And stdout contains "state: grilled"
    When I run gtd next
    Then it succeeds
    And stdout contains "Decompose it into an ordered set of"
    # The agent decomposes into one package; ARCHITECTURE.md is left for the machine to remove.
    When a file ".gtd/01-calc/01-add.md" with:
      """
      Implement add() in src/calc.ts.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: building"
    And the file ".gtd/ARCHITECTURE.md" does not exist
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the package described below"
    And stdout contains "Implement add() in src/calc.ts."
    # The builder writes the code.
    When a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): building"
    # agenticReview is off: the green check force-approves and closes INLINE —
    # one gtd: close-package commit, no marker.
    And the last commit subject is "gtd: close-package"
    And the file ".gtd" does not exist
    When I run gtd next
    Then it succeeds
    And stdout contains "help a human to review the changes"
    And stdout contains "src/calc.ts"
    # The review agent writes REVIEW.md.
    When a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234000000000000000000000000000000 -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      """
    When I run gtd step agent
    Then it succeeds
    # The review checkout window is now open: HEAD and index rest at the review
    # base (the cycle's first grilling turn) while the worktree still holds the
    # finished work, so any editor's git integration shows the whole package
    # diff as uncommitted changes. The real head is preserved under
    # refs/gtd/review-head until the review resolves.
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(human): grilling"
    And the git log at "refs/gtd/review-head" contains "gtd(agent): review"
    And the git log at "refs/gtd/review-head" contains "gtd: await-review"
    And the git status contains "src/calc.ts"
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/REVIEW.md"
    # Read-only commands re-arm the window on their way out.
    And the git ref "refs/gtd/review-head" exists
    # The human approves by deleting REVIEW.md (a plain worktree deletion).
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd(human): review"
    And the last commit subject is "gtd: done"
    And the file ".gtd/REVIEW.md" does not exist
    And the git ref "refs/gtd/review-head" does not exist
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: add .gtdrc
      gtd(human): grilling
      gtd(agent): grilling
      gtd(human): grilling-accepted
      gtd: architecting
      gtd(agent): architecting
      gtd(human): architecting-accepted
      gtd: grilled
      gtd(agent): grilled
      gtd: building
      gtd(agent): building
      gtd: close-package
      gtd(agent): review
      gtd: await-review
      gtd(human): review-approved
      gtd: done
      """
    # A final gtd step human at rest, with a green health check, adds zero commits.
    Given I record the commit count
    When I run gtd step human
    Then it succeeds
    And the commit count is unchanged
    And stdout contains "state: idle"

  Scenario: Happy path with squash on — the whole cycle collapses into one feat commit
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      squash: true
      learning: false
      """
    And a file "src/input.ts" with:
      """
      export const rawIdea = () => 42
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    When a file ".gtd/TODO.md" with:
      """
      # Plan

      Implement a calculator with add only, in src/calc.ts.
      """
    When I run gtd step agent
    Then it succeeds
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd: architecting"
    When a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Implement add() as a plain function export in src/calc.ts.
      """
    When I run gtd step agent
    Then it succeeds
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    When a file ".gtd/01-calc/01-add.md" with:
      """
      Implement add() in src/calc.ts.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: building"
    When a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: close-package"
    When a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234000000000000000000000000000000 -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      """
    When I run gtd step agent
    Then it succeeds
    # The review checkout window opens at the human gate: HEAD rests at the
    # base, the real head is preserved under refs/gtd/review-head.
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(human): grilling"
    And the git log at "refs/gtd/review-head" contains "gtd: await-review"
    Given the file ".gtd/REVIEW.md" is deleted
    # Squash on: gtd: done is not a rest — the chain continues straight to the
    # squash template in the same human-turn invocation.
    When I run gtd step human
    Then it succeeds
    And the git log contains "gtd: done"
    And the last commit subject is "gtd: squashing"
    And the file ".gtd/SQUASH_MSG.md" exists
    When I run gtd next
    Then it succeeds
    And stdout contains "conventional-commits"
    And stdout contains ".gtd/SQUASH_MSG.md"
    # The agent overwrites the template with the real message.
    Given ".gtd/SQUASH_MSG.md" is modified to:
      """
      feat: add calculator with add support
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "feat: add calculator with add support"
    And the file ".gtd/SQUASH_MSG.md" does not exist
    # v1/gtd subjects are gone from the final log — only the squashed commit remains.
    And the git log does not contain "gtd: grilling"
    And the git log does not contain "gtd(human): grilling"
    And the git log does not contain "gtd(agent): grilling"
    And the git log does not contain "gtd: architecting"
    And the git log does not contain "gtd(agent): architecting"
    And the git log does not contain "gtd(human): architecting"
    And the git log does not contain "gtd: grilled"
    And the git log does not contain "gtd: building"
    And the git log does not contain "gtd(agent): building"
    And the git log does not contain "gtd: tests-green"
    And the git log does not contain "gtd: close-package"
    And the git log does not contain "gtd(agent): review"
    And the git log does not contain "gtd: await-review"
    And the git log does not contain "gtd(human): review"
    And the git log does not contain "gtd: done"
    And the git log does not contain "gtd: squashing"
    And the file "src/calc.ts" exists

  Scenario: Red-then-fixed — a failing build turn detours through fixing before landing green
    Given a test project
    And a commit "chore: add gate.sh" that adds "gate.sh" with:
      """
      echo SENTINEL_JOURNEY_FAILURE
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      agenticReview: false
      squash: false
      """
    And a commit "gtd: grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Implement a helper.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds ".gtd/01-helper/01-task.md" with:
      """
      Implement the helper.
      """
    # The builder's first attempt is broken — the gate stays red.
    When a file "src/helper.ts" with:
      """
      export const helper = () => undefined
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): building"
    And the git log contains "gtd: test-failed"
    And the file ".gtd/FEEDBACK.md" contains "SENTINEL_JOURNEY_FAILURE"
    When I run gtd next
    Then it succeeds
    And stdout contains "Spawn a **fix subagent**"
    And stdout contains "SENTINEL_JOURNEY_FAILURE"
    # The fixer makes the gate pass.
    Given "gate.sh" is modified to:
      """
      echo ALL_GREEN
      exit 0
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): fixing"
    # The fix-round green force-approves and closes INLINE — one commit, no
    # marker, no extra checkpoint hop.
    And the last commit subject is "gtd: close-package"
    And the file ".gtd/FEEDBACK.md" does not exist

  Scenario: A grilling round with one human answer, then onward to a green build
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      squash: false
      """
    # Simulate the agent's initial sketch commit landing as a boundary commit —
    # the human's dirty-tree turn is the true entry point.
    When a file "notes.md" with:
      """
      Build a calculator with add and subtract.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    When I run gtd next
    Then it succeeds
    And stdout contains "notes.md"
    # The agent develops the plan but leaves an open question for the human.
    When a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      Suggested default: add and subtract.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    When I run gtd next
    Then it succeeds
    And stdout contains ".gtd/TODO.md"
    # The human answers inline in TODO.md — this is itself a human turn (not
    # an empty accept), so grilling iterates rather than converging.
    Given ".gtd/TODO.md" is modified to:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      Answer: add, subtract, and multiply.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And the file ".gtd/TODO.md" contains "Answer: add, subtract, and multiply."
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    When I run gtd next
    Then it succeeds
    And stdout contains "Develop it into a concrete"
    # The agent converges the plan with no more open questions.
    Given ".gtd/TODO.md" is modified to:
      """
      # Plan

      Build a calculator with add, subtract, and multiply.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling"
    # A clean human step (accept) converges to architecting.
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd: architecting"
    # The architecting agent converges immediately, with no open questions.
    When a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Implement add, subtract, and multiply as plain function exports in src/calc.ts.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): architecting"
    # A clean human step (accept) converges to grilled.
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    When a file ".gtd/01-calc/01-task.md" with:
      """
      Implement add, subtract, and multiply in src/calc.ts.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd: building"
    When a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      export const multiply = (a: number, b: number) => a * b
      """
    When I run gtd step agent
    Then it succeeds
    And the git log contains "gtd(agent): building"
    And the last commit subject is "gtd: close-package"
