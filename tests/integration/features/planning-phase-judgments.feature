Feature: Planning-phase judgments (.gtd/packages/04-planning-phase-judgments.md)

  `architecture-pre` renders one fixed noul (`architectureWarranted`) over
  the just-triaged `.gtd/REQUIREMENTS.md`, routing a confident "no" to
  `architecture-promote` (which writes the plan straight into a single
  package file, skipping `architecture.author`/`architecture.decompose`
  entirely) and everything else to the full architecture pass. Each
  scenario reaches it by the shortest real history — an ordinary `feature` start and a triage turn writing a question-free plan.
  `architecture-promote`'s own shell body is a workflow-authored script a
  real DRIVER runs (never this test harness) — its effect is given by hand.

  @inmem
  Scenario: a trivial, one-concern plan judged not to warrant an architecture pass reaches the package queue without an architecture turn
    Given a test project
    And the workflow
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string. No open questions,
      no structural decisions, one file touched.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
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
    And the last commit subject is "gtd(check): architecture-promote → packages.item.building"
    And ".gtd/packages/01-greeting-export.md" exists
    And the git log does not contain "architecture.author"
    And the git log does not contain "architecture.decompose"

  @live
  Scenario: architecture-promote's real script — executed for real — slugifies the plan's own first heading and promotes .gtd/REQUIREMENTS.md wholesale into that single package file
    Given a test project
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting Export!

      Add a `greet()` export returning a friendly string. No open questions,
      no structural decisions, one file touched.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
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
    And the last commit subject is "gtd(check): architecture-promote → packages.item.building"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/packages/01-greeting-export.md" exists

  # A plan the judge budget cut never skips the architecture pass, however
  # confident the judged "no" was: the flow goes straight on to
  # architecture.author, leaving `.gtd/REQUIREMENTS.md` in place.
  @inmem
  Scenario: a plan whose architectureWarranted verdict was answered against a judgeBudgetBytes-truncated payload is never promoted
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "40"
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## A plan whose first concern is over 40 bytes long

      This plan's own text is longer than the 40-byte judge payload budget,
      so the judge budget truncates it before the judge
      ever sees this paragraph — the structural concern living right here,
      near the top, is exactly what a truncated "no" could miss.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → architecture-pre"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "architectureWarranted", "answer": false, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture.author"
    And ".gtd/REQUIREMENTS.md" exists
