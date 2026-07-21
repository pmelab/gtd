@live
Feature: gtd-loop — the packaged reference loop driver

  `bin/gtd-loop` is the installable implementation of the two-beat protocol
  documented in docs/loop.md's "The reference loop driver". These scenarios spawn
  it as a real subprocess (never the real `claude` CLI — a stub agent script
  stands in, wired through `GTD_LOOP_AGENT_CMD`) to prove its control flow:
  chaining agent turns, halting at a human gate, picking up an uncommitted
  human edit on rerun, and detecting a stalled agent turn.

  Scenario: Chains several agent turns, then halts at the next human gate
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      squash: false
      """
    And a commit "gtd(agent): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Implement a calculator with add only, in src/calc.ts.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds ".gtd/01-calc/01-add.md" with:
      """
      Implement add() in src/calc.ts.
      """
    And a stub agent script that responds to prompts with:
      """
      case "$GTD_LOOP_PROMPT" in
        *"Build the package described below"*)
          mkdir -p src
          cat > src/calc.ts <<'CALC'
      export const add = (a: number, b: number) => a + b
      CALC
          ;;
        *"help a human to review the changes"*)
          mkdir -p .gtd
          cat > .gtd/REVIEW.md <<'REVIEW'
      # Review: abc1234

      <!-- base: abc1234000000000000000000000000000000 -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      REVIEW
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run gtd-loop
    Then it succeeds
    And stdout contains "--- Your turn (await-review) ---"
    # The loop halts with the review checkout window open: HEAD/index rest at
    # the review base so the whole package diff shows as uncommitted changes in
    # the reviewer's editor; the real head sits in refs/gtd/review-head.
    And the git ref "refs/gtd/review-head" exists
    And the last commit subject is "gtd(agent): grilling"
    And the git log at "refs/gtd/review-head" contains "gtd(agent): building"
    And the git log at "refs/gtd/review-head" contains "gtd: close-package"
    And the git log at "refs/gtd/review-head" contains "gtd(agent): review"
    And the git log at "refs/gtd/review-head" contains "gtd: await-review"
    And the git status contains "src/calc.ts"

  Scenario: Rerunning after an uncommitted human edit picks it up and continues
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      squash: false
      learning: false
      """
    And a commit "gtd(agent): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Implement a calculator with add only, in src/calc.ts.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds ".gtd/01-calc/01-add.md" with:
      """
      Implement add() in src/calc.ts.
      """
    And a stub agent script that responds to prompts with:
      """
      case "$GTD_LOOP_PROMPT" in
        *"Build the package described below"*)
          mkdir -p src
          cat > src/calc.ts <<'CALC'
      export const add = (a: number, b: number) => a + b
      CALC
          ;;
        *"help a human to review the changes"*)
          mkdir -p .gtd
          cat > .gtd/REVIEW.md <<'REVIEW'
      # Review: abc1234

      <!-- base: abc1234000000000000000000000000000000 -->

      ## Add calculator

      - [ ] ./src/calc.ts#1
      REVIEW
          ;;
        *)
          echo "gtd-loop test stub: unrecognized prompt" >&2
          exit 1
          ;;
      esac
      """
    When I run gtd-loop
    Then it succeeds
    And the git ref "refs/gtd/review-head" exists
    And the git log at "refs/gtd/review-head" contains "gtd: await-review"
    # The human approves the review by deleting REVIEW.md, without committing —
    # exactly the "edit, don't commit, just rerun" workflow gtd-loop supports.
    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd-loop
    Then it succeeds
    And the git log contains "gtd(human): review"
    And the git log contains "gtd: done"
    And the git ref "refs/gtd/review-head" does not exist
    And stdout contains "--- Your turn (idle) ---"

  Scenario: Stops instead of spinning when the agent's turn makes no progress
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: "true"
      agenticReview: false
      squash: false
      """
    And a commit "gtd(agent): grilling" that adds ".gtd/TODO.md" with:
      """
      # Plan

      Implement a calculator with add only, in src/calc.ts.
      """
    And a commit "gtd: building" that deletes ".gtd/TODO.md"
    And a commit "gtd: building" that adds ".gtd/01-calc/01-add.md" with:
      """
      Implement add() in src/calc.ts.
      """
    And a stub agent script that responds to prompts with:
      """
      : # does nothing — the build prompt is never acted on
      """
    When I run gtd-loop
    Then it fails
    And stderr contains "no progress at 'building'"
