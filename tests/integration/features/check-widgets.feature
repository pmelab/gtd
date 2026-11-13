Feature: gtd check <file> — a steering file's widget structure

  `gtd check <file>` reads a steering file as widgets and prints each
  structural finding as `file:line: message`, exiting 1 when there is any.
  `--write` first rewrites the file in its canonical form. It reads no
  workflow and runs from any directory.

  @inmem
  Scenario: a well-formed widget file passes silently
    Given a file "PLAN.md" with:
      """
      # Plan

      ## 🔘 Where is the counter stored?

      - [ ] Redis
      - [ ] ✏️
      """
    When I run gtd with args "check PLAN.md"
    Then it succeeds
    And stdout is empty

  @inmem
  Scenario: a widget heading with no checkbox list fails with its line
    Given a file "PLAN.md" with:
      """
      # Plan

      ## ❔ Ship behind a flag?

      Yes or no.
      """
    When I run gtd with args "check PLAN.md"
    Then it fails
    And stdout is empty
    And stderr contains "PLAN.md:3: \"Ship behind a flag?\": a ❔ widget needs its checkbox list before the next heading"

  @inmem
  Scenario: --write rewrites the file in its canonical form
    Given a file "PLAN.md" with:
      """
      # Plan

      One
      paragraph
      over three lines.
      """
    When I run gtd with args "check --write PLAN.md"
    Then it succeeds
    And the file "PLAN.md" contains "One paragraph over three lines."

  @inmem
  Scenario: a missing file fails
    When I run gtd with args "check PLAN.md"
    Then it fails
    And stderr contains "no such file: PLAN.md"
