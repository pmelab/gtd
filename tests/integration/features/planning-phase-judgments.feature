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
  this test harness, same convention `packages.spec.scoping`'s own
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
    And the last commit subject is "gtd(check): architecture-promote → packages-sweep"
    And ".gtd/packages/01-greeting-export.md" exists
    And the git log does not contain "architecture.author"
    And the git log does not contain "architecture.decompose"

    # packages-sweep's own clean step (nothing to sweep) enters the queue —
    # `each: { glob: '.gtd/packages/*.md' }` snapshots the promoted package,
    # genuinely non-empty on the skip path, never draining straight to
    # $onDrained on an empty .gtd/packages/.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages-sweep → packages[0].building"

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
    And the last commit subject is "gtd(check): architecture-promote → packages-sweep"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/packages/01-greeting-export.md" exists

  # `.gtd/packages/02-judge-gate-soundness.md` Task "Refuse the architecture
  # skip on a truncated payload" — `architecture-promote`'s own script (a
  # real DRIVER's job, its effect given by hand here, same convention as the
  # first scenario in this file) must do nothing at all — leaving
  # `.gtd/REQUIREMENTS.md` in place — when the landing commit it reads
  # carries `Gtd-Payload: {"truncated":true}`, so the clean tree routes
  # through the "C" row into the full architecture pass instead of a false
  # promotion, however confident the judged "no" was. Real execution of this
  # same script, both directions, is pinned by
  # `src/workflows/templates.test.ts`'s "architecture-promote refuses the
  # skip on a truncated payload" tests.
  @inmem
  Scenario: architecture-promote refuses to promote a plan whose architectureWarranted verdict was answered against a judgeBudgetBytes-truncated payload
    Given a test project
    And the workflow
    And an environment variable "GTD_JUDGEBUDGETBYTES" set to "40"
    And a commit "gtd(human): architecture-pre" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## A plan whose first concern is over 40 bytes long

      This plan's own text is longer than the 40-byte judge payload budget,
      so `it.tail(".gtd/REQUIREMENTS.md", 1)` truncates it before the judge
      ever sees this paragraph — the structural concern living right here,
      near the top, is exactly what a truncated "no" could miss.
      """
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
    # landing commit — the tree stays clean, matching the "C" row.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): architecture-promote → architecture.author"
    And ".gtd/REQUIREMENTS.md" exists
