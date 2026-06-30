Feature: Testing — the bounded test/fix loop and escalation

  A clean `.gtd/` with a reason to test (pending code, a pending ERRORS.md
  deletion, or a no-op fixer) runs the configured test command. Green proceeds to
  Agentic Review; red below the fix-attempt cap writes a non-empty FEEDBACK.md
  (`gtd: errors`) and routes to Fixing; red at the cap writes ERRORS.md instead
  and stops at Escalate. Removing ERRORS.md resets the budget.

  Scenario: A green test gate advances the built package to Agentic Review
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: building"
    And the last commit subject is "gtd: building"
    And stdout contains "## Task: Agentic review of the built package"

  Scenario: A red gate below the cap writes FEEDBACK.md and routes to Fixing
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_FAILURE
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: errors"
    And the last commit subject is "gtd: fixing"
    # The run auto-advances Testing → Fixing: Testing writes FEEDBACK.md as the
    # `gtd: errors` commit (above), then Fixing consumes it — inlining the output
    # into the prompt and committing its removal as `gtd: fixing`. So FEEDBACK.md
    # is gone by the end of this single invocation (the `gtd: errors` commit is the
    # durable record that it was written).
    And the file "FEEDBACK.md" does not exist
    And stdout contains "## Task: Fix the package against `FEEDBACK.md`"
    And stdout contains "SENTINEL_FAILURE"

  Scenario: A red gate with no output still routes to Fixing, not Close package
    Given a test project
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: errors"
    And the last commit subject is "gtd: fixing"
    And stdout contains "## Task: Fix the package against `FEEDBACK.md`"
    And stdout does not contain "## Task: Close"
    And stdout does not contain "gtd: package done"

  Scenario: A red gate at the fix-attempt cap writes ERRORS.md and escalates
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_FAILURE
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors"
    And a commit "gtd: errors"
    And a commit "gtd: errors"
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd
    Then it succeeds
    And the file "ERRORS.md" exists
    And the file "FEEDBACK.md" does not exist
    And the last commit subject is "gtd: errors"
    And stdout contains "## Task: Escalate"
    And stdout contains "STOP"
    And stdout does not contain "## Task: Fix the package"

  Scenario: A committed ERRORS.md stops at Escalate as a human gate
    Given a test project
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds "ERRORS.md" with:
      """
      The test gate failed three times with the same assertion.
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Escalate"
    And stdout contains "STOP"
    And stdout does not contain "## Task: Agentic review"

  Scenario: Removing ERRORS.md resets the budget and re-tests with a fresh round
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors" that adds "ERRORS.md" with:
      """
      Earlier escalation output.
      """
    And a deleted committed file "ERRORS.md"
    When I run gtd
    Then it succeeds
    And the file "ERRORS.md" does not exist
    And the git log contains "gtd: building"
    And stdout does not contain "## Task: Escalate"
    And stdout contains "## Task: Agentic review of the built package"

  Scenario: A no-op fixer (clean tree, HEAD gtd: fixing) is re-tested
    # The fixer produced no change, so the tree is clean under a `gtd: fixing`
    # HEAD. Testing re-runs the gate anyway; the red result lands a `gtd: errors`
    # from a clean tree — only the re-test path can produce that.
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo STILL_BROKEN
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: fixing"
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: errors"
    And the last commit subject is "gtd: fixing"
    And stdout contains "## Task: Fix the package against `FEEDBACK.md`"
    And stdout contains "STILL_BROKEN"

  Scenario: A no-op fixer whose re-test is green advances to Agentic Review
    # The fixer produced no change (clean tree, HEAD `gtd: fixing`), so Testing
    # commits nothing for code. A GREEN re-test must still advance HEAD off
    # `gtd: fixing` (an empty `gtd: building`) and proceed to review — otherwise
    # gather→resolve keeps returning Testing and the driver spins to MAX_EDGE_HOPS.
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo ALL_GREEN
      exit 0
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: fixing"
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: building"
    And the last commit subject is "gtd: building"
    And stdout contains "## Task: Agentic review of the built package"

  Scenario: A red gate at the cap on the default branch (trunk) writes ERRORS.md and escalates
    Given a test project
    And a default branch "main"
    And a commit "chore: test gate" that adds "gate.sh" with:
      """
      echo SENTINEL_FAILURE
      exit 1
      """
    And a gtd config file at ".gtdrc" with:
      """
      testCommand: bash gate.sh
      """
    And a commit "gtd: planning" that adds ".gtd/01-foo/01-task.md" with:
      """
      Implement the helper.
      """
    And a commit "gtd: errors"
    And a commit "gtd: errors"
    And a commit "gtd: errors"
    And a file "src/helper.ts" with:
      """
      export const helper = (x: string) => x
      """
    When I run gtd
    Then it succeeds
    And the file "ERRORS.md" exists
    And the file "FEEDBACK.md" does not exist
    And the last commit subject is "gtd: errors"
    And stdout contains "## Task: Escalate"
    And stdout contains "STOP"
    And stdout does not contain "## Task: Fix the package"
