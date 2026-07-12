@inmem
Feature: Architecting — technical grilling on the converged product plan

  Architecting is grilling's second phase, mechanically identical to it: the
  agent develops `.gtd/ARCHITECTURE.md` into a concrete technical plan
  (file/module structure, data model, tech-stack choices) and the human either
  answers inline or accepts the suggested defaults with a clean `gtd step`.
  Normally `.gtd/ARCHITECTURE.md` is seeded from the converged `.gtd/TODO.md`
  at the end of product grilling (see `grilling.feature`'s convergence
  scenario). But the entry itself is file-presence-driven, not history-driven:
  if a human's very first dirty tree already contains `.gtd/ARCHITECTURE.md`
  (their own already-technical sketch), `gtd step` captures the entry turn
  directly as `gtd(human): architecting` — product grilling is skipped
  entirely, and `.gtd/TODO.md` never exists for that cycle. A clean `gtd step`
  at architecting's answer gate converges to `gtd: grilled` and prompts
  decompose.

  Scenario: The escape hatch — a dirty tree seeded with ARCHITECTURE.md enters architecting directly, skipping product grilling
    Given a test project
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Refactor the calculator module to use a strategy pattern.
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): architecting"
    And the file ".gtd/ARCHITECTURE.md" exists
    And the file ".gtd/ARCHITECTURE.md" contains "Refactor the calculator module to use a strategy pattern."
    And the file ".gtd/TODO.md" does not exist
    And the git log does not contain "gtd(human): grilling"
    And stdout contains "committed: gtd(human): architecting"

  Scenario: gtd next hands the agent the human's turn diff at the escape-hatch entry
    Given a test project
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Refactor the calculator module to use a strategy pattern.
      """
    And I run gtd step
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    When I run gtd next
    Then it succeeds
    And stdout contains "Finish your turn by running `gtd step-agent`."

  Scenario: The agent's architecture turn gates on a human to answer inline
    Given a test project
    And a commit "gtd: architecting" that adds ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Build a calculator.
      """
    And ".gtd/ARCHITECTURE.md" is modified to:
      """
      # Architecture

      Build a calculator.

      ## Which language runtime?

      Suggested default: TypeScript on Node.js.
      """
    When I run gtd step-agent
    Then it succeeds
    And the last commit subject is "gtd(agent): architecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"human\""
    And stdout contains ".gtd/ARCHITECTURE.md"

  Scenario: Human answers in ARCHITECTURE.md and the agent architecting prompt carries the answer diff
    Given a test project
    And a commit "gtd: architecting" that adds ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Build a calculator.
      """
    And ".gtd/ARCHITECTURE.md" is modified to:
      """
      # Architecture

      Build a calculator.

      ## Which language runtime?

      Suggested default: TypeScript on Node.js.
      """
    And I run gtd step-agent
    And "code.ts" is modified to:
      """
      export const c = 1
      """
    And ".gtd/ARCHITECTURE.md" is modified to:
      """
      # Architecture

      Build a calculator.

      ## Which language runtime?

      Answer: TypeScript on Deno.
      """
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd(human): architecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "TypeScript on Deno"

  Scenario: A clean step at the answer gate converges to Grilled and prompts decompose
    Given a test project
    And a commit "gtd: architecting" that adds ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Build a calculator with add and subtract.
      """
    And ".gtd/ARCHITECTURE.md" is modified to:
      """
      # Architecture

      Build a calculator with add and subtract.

      ## Which language runtime?

      Suggested default: TypeScript on Node.js.
      """
    And I run gtd step-agent
    When I run gtd step
    Then it succeeds
    And the last commit subject is "gtd: grilled"
    And the file ".gtd/ARCHITECTURE.md" exists
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "Decompose it into an ordered set of"

  Scenario: A do-nothing agent invocation at the architecting rest is inert and re-emits the same prompt
    Given a test project
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      # Architecture

      Build a calculator with add and subtract.
      """
    And I run gtd step
    And I record the commit count
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
    And the last commit subject is "gtd(human): architecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"actor\":\"agent\""
    When I run gtd step-agent
    Then it succeeds
    And the commit count is unchanged
