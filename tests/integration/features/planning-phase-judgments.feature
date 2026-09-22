Feature: Planning-phase judgments (.gtd/packages/04-planning-phase-judgments.md)

  `architecture-pre` renders one fixed noul (`architectureWarranted`) over
  the just-triaged `.gtd/REQUIREMENTS.md`, routing a confident "no" to
  `architecture-promote` (which writes the plan straight into a single
  package file, skipping `architecture.author`/`architecture.decompose`
  entirely) and everything else to the full architecture pass. Entered
  directly here (a fabricated commit history, `machine-memory.feature`'s
  technique) rather than walked through triage/design.gate — the states
  under test don't care how the process got there. `architecture-promote`'s
  own shell body is a workflow-authored script a real DRIVER runs (never
  this test harness, same convention `packages.item.spec.scoping`'s own
  script uses elsewhere in this suite) — its effect is given by hand.

  @inmem
  Scenario: a trivial, one-concern plan judged not to warrant an architecture pass reaches the package queue without an architecture turn
    Given a test project
    And the workflow
    And a commit "gtd(human): architecture-pre" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string. No open questions,
      no structural decisions, one file touched.
      """
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "architectureWarranted", "answer": false, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture-promote"

    # architecture-promote's own script (a real DRIVER's job) promotes
    # .gtd/REQUIREMENTS.md wholesale into a single package file — never
    # split, architecture.decompose's own job, skipped here.
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-greeting-export.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string. No open questions,
      no structural decisions, one file touched.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): architecture-promote → packages.picking"
    And ".gtd/packages/01-greeting-export.md" exists
    And the git log does not contain "architecture.author"
    And the git log does not contain "architecture.decompose"

    # packages.picking's own script (a real DRIVER's job) finds the
    # promoted package and points NEXT.md at it — the queue is genuinely
    # non-empty on the skip path, never draining straight to $onDrained on
    # an empty .gtd/packages/.
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-greeting-export.md
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → packages.item.building"

  @live
  Scenario: architecture-promote's real script — executed for real — slugifies the plan's own first heading and promotes .gtd/REQUIREMENTS.md wholesale into that single package file
    Given a test project
    And a commit "gtd(human): architecture-pre" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting Export!

      Add a `greet()` export returning a friendly string. No open questions,
      no structural decisions, one file touched.
      """
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "architectureWarranted", "answer": false, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture-promote"

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): architecture-promote → packages.picking"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/packages/01-greeting-export.md" exists
