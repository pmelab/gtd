Feature: Planning-phase judgments (.gtd/packages/04-planning-phase-judgments.md)

  `architecture-pre` renders one fixed noul (`architectureWarranted`) over
  the just-triaged `.gtd/REQUIREMENTS.md`, routing a confident "no" to
  `architecture-promote` (which writes the plan straight into a single
  package file, skipping `architecture.author`/`architecture.decompose`
  entirely) and everything else to the full architecture pass. Each
  scenario reaches it by the shortest real history — `--entry
  start-gate.check`, a triage turn writing the plan, a question-free
  `design.gate.check`. `architecture-promote`'s
  own shell body is a workflow-authored script a real DRIVER runs (never
  this test harness, same convention `packages.item.spec.scoping`'s own
  script uses elsewhere in this suite) — its effect is given by hand.

  @inmem
  Scenario: a trivial, one-concern plan judged not to warrant an architecture pass reaches the package queue without an architecture turn
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string. No open questions,
      no structural decisions, one file touched.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "architectureWarranted", "answer": false, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture-promote"
    And the last commit body does not contain "Gtd-Payload:"

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
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting Export!

      Add a `greet()` export returning a friendly string. No open questions,
      no structural decisions, one file touched.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
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

  # `.gtd/packages/02-judge-gate-soundness.md` Task "Refuse the architecture
  # skip on a truncated payload" — `architecture-promote`'s own script (a
  # real DRIVER's job, its effect given by hand here, same convention as the
  # first scenario in this file) must do nothing at all — leaving
  # `.gtd/REQUIREMENTS.md` in place — when the landing commit it reads
  # carries `Gtd-Payload: {"truncated":true}`, so the clean tree routes
  # on to the full architecture pass instead of a false promotion, however
  # confident the judged "no" was.
  @inmem
  Scenario: architecture-promote refuses to promote a plan whose architectureWarranted verdict was answered against a judgeBudgetBytes-truncated payload
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "40"
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## A plan whose first concern is over 40 bytes long

      This plan's own text is longer than the 40-byte judge payload budget,
      so `it.tail(".gtd/REQUIREMENTS.md", 1)` truncates it before the judge
      ever sees this paragraph — the structural concern living right here,
      near the top, is exactly what a truncated "no" could miss.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "architectureWarranted", "answer": false, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture-promote"
    And the last commit body contains "Gtd-Payload: {\"truncated\":true}"

    # architecture-promote's own script does nothing on this truncated
    # landing commit — the clean tree goes on to the full architecture pass.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): architecture-promote → architecture.author"
    And ".gtd/REQUIREMENTS.md" exists
