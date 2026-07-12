@inmem
Feature: Grilling — human sketch, agent plan, human answers, clean-step convergence

  Grilling starts the moment a human turn lands at a boundary HEAD with a dirty
  tree: `gtd step` captures everything pending into one `gtd(human): grilling`
  turn commit — no TODO.md is seeded by the machine and nothing is reverted, so
  the captured files stay in history and the tree is clean afterwards. `gtd next`
  then hands the agent that turn's diff. The agent writes/edits TODO.md and
  `gtd step-agent`s a `gtd(agent): grilling` turn, which gates on a human to
  answer inline in TODO.md (or accept defaults). A clean `gtd step` at that gate
  is the sole convergence signal — no marker text is ever parsed — landing an
  empty `gtd(human): grilling` plus routing `gtd: architecting`, which seeds
  `.gtd/ARCHITECTURE.md` from the converged TODO.md content, removes TODO.md,
  and prompts the architecting agent (see `architecting.feature` for that
  phase's own contract).

  Scenario: A dirty boundary tree becomes one human grilling turn, nothing reverted
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    And the file "notes.md" exists
    And the file "notes.md" contains "Build a calculator that can add and subtract."
    And the file ".gtd/TODO.md" does not exist
    And stdout contains "committed: gtd(human): grilling"
    And stdout contains "state:"

  Scenario: gtd next hands the agent the human's turn diff
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "notes.md"
    And stdout contains "Build a calculator that can add and subtract."
    When I run gtd next
    Then it succeeds
    And stdout contains "Finish your turn by running `gtd step-agent`."

  Scenario: The agent's plan turn gates on a human to answer inline
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      Suggested default: add and subtract.
      """
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "gtd(agent): grilling"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    And stdout contains ".gtd/TODO.md"

  # TODO.md itself is a steering file and never appears in the inlined turn
  # diff (by design — the diff must never carry steering-file churn), so the
  # human's answer turn also touches a non-steering file to make the answer
  # visible in the diff the agent prompt inlines.
  Scenario: Human answers in TODO.md and the agent grilling prompt carries the answer diff
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      Suggested default: add and subtract.
      """
    And I run gtd step-agent
    And ".gtd/TODO.md" is modified to:
      """
      # Plan

      Build a calculator.

      ## Which operations?

      Answer: add, subtract, and multiply.
      """
    And "notes.md" is modified to:
      """
      Build a calculator that can add, subtract, and multiply.
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): grilling"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "add, subtract, and multiply"

  Scenario: A clean step at the answer gate converges to Architecting, seeding ARCHITECTURE.md from TODO.md
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator that can add and subtract.
      """
    And I run gtd step
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator with add and subtract.

      ## Which operations?

      Suggested default: add and subtract.
      """
    And I run gtd step-agent
    When I run gtd step
    Then it succeeds
    And the git log contains "gtd(human): grilling"
    And the last commit subject is "gtd: architecting"
    And the file ".gtd/TODO.md" does not exist
    And the file ".gtd/ARCHITECTURE.md" exists
    And the file ".gtd/ARCHITECTURE.md" contains "Build a calculator with add and subtract."
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "Develop it into a concrete"

  Scenario: The literal marker text is inert — it no longer stops for the user
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator with add and subtract.
      """
    And I run gtd step
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      Build a calculator with add and subtract.

      <!-- user answers here -->
      """
    And I run gtd step-agent
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd: architecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "Develop it into a concrete"

  Scenario: A do-nothing agent invocation at the grilling rest is inert and re-emits the same prompt
    Given a test project
    And a file "notes.md" with:
      """
      Build a calculator with add and subtract.
      """
    And I run gtd step
    And I record the commit count
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
    And the last commit subject is "gtd(human): grilling"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
