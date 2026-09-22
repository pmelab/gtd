Feature: Planning-phase judgments (.gtd/packages/04-planning-phase-judgments.md)

  `questionGate.screen` renders three outputs per open question in whichever
  of `.gtd/REQUIREMENTS.md`/`.gtd/ARCHITECTURE.md` carries them: two nouls
  (`blocking-N`/`inferable-N`) and a `choice` (`pick-N`, the actual inferred
  answer — one of that question's own listed options, verbatim).
  `questionGate.decide` recomputes the skip decision fresh from the landed
  `Gtd-Judge:` trailers and a fresh `gtd check qa --open-questions` listing,
  skipping the human stop (`questionGate.answer`) only when every open
  question cleared the bar (not blocking, confidently inferable, AND a
  non-blank `pick-N`) — each one TICKED into the gate's own file (its `##
  Open Questions` section folded into `## Answered Questions`, using the
  `pick-N` answer) and recorded as its own line in `.gtd/ASSUMPTIONS.md`,
  naming both the question and its inferred answer. `architecture-pre`
  renders one fixed noul
  (`architectureWarranted`) over the just-triaged `.gtd/REQUIREMENTS.md`,
  routing a confident "no" to `architecture-promote` (which writes the plan
  straight into a single package file, skipping `architecture.author`/
  `architecture.decompose` entirely) and everything else to the full
  architecture pass. Entered directly here (a fabricated commit history,
  `machine-memory.feature`'s technique) rather than walked through
  triage/design.gate — the states under test don't care how the process got
  there. `questionGate.decide`'s and `architecture-promote`'s own shell
  bodies are workflow-authored scripts a real DRIVER runs (never this test
  harness, same convention `packages.item.spec.scoping`'s own script uses
  elsewhere in this suite) — their effect is given by hand.

  @inmem
  Scenario: every open question judged non-blocking, inferable, and confidently picked skips design.gate.answer — the resulting .gtd/REVIEW.md names the inferred answer, not just the question
    Given a test project
    And the workflow
    And a commit "gtd(human): design.gate.screen" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a greet() export returning a friendly string.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite
      - [ ] Postgres
      - [ ] _your answer_
      """
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "blocking-1", "answer": false, "p": 0.95},
        {"id": "inferable-1", "answer": true, "p": 0.95},
        {"id": "pick-1", "answer": "SQLite", "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.screen → design.gate.decide"

    # design.gate.decide's own script (a real DRIVER's job, not this
    # harness's) finds the one open question non-blocking, confidently
    # inferable, and picked — ticks "SQLite" into .gtd/REQUIREMENTS.md's own
    # Answered Questions section and records the answer as an assumption.
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Greeting export

      Add a greet() export returning a friendly string.

      ## Answered Questions

      ### Which storage backend?

      SQLite
      """
    And a file ".gtd/ASSUMPTIONS.md" with:
      """
      - Which storage backend? → SQLite — not blocking, confidently inferable; skipped without asking (design phase).
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.decide → architecture-pre"
    And the git log does not contain "design.gate.answer"
    And ".gtd/REQUIREMENTS.md" does not contain "## Open Questions"
    And ".gtd/QUESTIONS.md" does not exist

    # Fast-forward straight to the review tail — humanReview.reviewing folds
    # .gtd/ASSUMPTIONS.md into its own "## Assumptions" chunk, naming the
    # inferred ANSWER, not just the question that was skipped.
    Given a commit "gtd(agent): build.review.reviewing" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## Storage backend

      - [ ] ./src/db.ts#1 — adds the SQLite-backed store

      ## Assumptions

      - Which storage backend? → SQLite — not blocking, confidently inferable; skipped without asking (design phase).
      """
    And the file ".gtd/ASSUMPTIONS.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.reviewing → build.review.await-review"
    And ".gtd/REVIEW.md" contains "## Assumptions"
    And ".gtd/REVIEW.md" contains "Which storage backend? → SQLite"
    And ".gtd/ASSUMPTIONS.md" does not exist

  @inmem
  Scenario: a blocking open question still stops for the human, even alongside a non-blocking one
    Given a test project
    And the workflow
    And a commit "gtd(human): design.gate.screen" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Payment provider

      Add a payment integration.

      ## Open Questions

      ### Which payment provider?

      - [ ] Stripe
      - [ ] Adyen
      - [ ] _your answer_

      ### Which log level default?

      - [ ] info
      - [ ] debug
      - [ ] _your answer_
      """
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "blocking-1", "answer": true, "p": 0.97},
        {"id": "inferable-1", "answer": false, "p": 0.9},
        {"id": "pick-1", "answer": "", "p": 0.9},
        {"id": "blocking-2", "answer": false, "p": 0.95},
        {"id": "inferable-2", "answer": true, "p": 0.95},
        {"id": "pick-2", "answer": "debug", "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.screen → design.gate.decide"

    # design.gate.decide's own script finds the payment-provider question
    # both blocking and not confidently inferable — nothing to write, since
    # not EVERY question cleared the bar, so a clean tree stops for the
    # human at design.gate.answer instead of skipping it.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.decide → design.gate.answer"
    And ".gtd/ASSUMPTIONS.md" does not exist

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
    And the last commit subject is "gtd(human): architecture-pre → architecture-promote"

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
  Scenario: design.gate.decide's real script — the skip branch, executed for real — folds the cleared question into Answered Questions, records the assumption, validates the picked option, and clears .gtd/QUESTIONS.md
    Given a test project
    And a commit "gtd(human): design.gate.screen" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a greet() export returning a friendly string.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite
      - [ ] Postgres
      - [ ] _your answer_
      """
    And a commit "gtd(human): design.gate.screen" that adds ".gtd/QUESTIONS.md" with:
      """
      open questions remain in .gtd/REQUIREMENTS.md
      """
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "blocking-1", "answer": false, "p": 0.95},
        {"id": "inferable-1", "answer": true, "p": 0.95},
        {"id": "pick-1", "answer": "SQLite", "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.screen → design.gate.decide"

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.decide → architecture-pre"
    And ".gtd/REQUIREMENTS.md" does not contain "## Open Questions"
    And ".gtd/REQUIREMENTS.md" contains "## Answered Questions"
    And ".gtd/REQUIREMENTS.md" contains "SQLite"
    And ".gtd/ASSUMPTIONS.md" contains "Which storage backend? → SQLite"
    And ".gtd/QUESTIONS.md" does not exist

  @live
  Scenario: design.gate.decide's real script refuses an invented pick-N — not one of the question's own listed options — and stops for the human instead
    Given a test project
    And a commit "gtd(human): design.gate.screen" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a greet() export returning a friendly string.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite
      - [ ] Postgres
      - [ ] _your answer_
      """
    And a commit "gtd(human): design.gate.screen" that adds ".gtd/QUESTIONS.md" with:
      """
      open questions remain in .gtd/REQUIREMENTS.md
      """
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "blocking-1", "answer": false, "p": 0.95},
        {"id": "inferable-1", "answer": true, "p": 0.95},
        {"id": "pick-1", "answer": "MySQL", "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.screen → design.gate.decide"

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.decide → design.gate.answer"
    And ".gtd/REQUIREMENTS.md" contains "## Open Questions"
    And ".gtd/ASSUMPTIONS.md" does not exist
    And ".gtd/QUESTIONS.md" exists

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
    And the last commit subject is "gtd(human): architecture-pre → architecture-promote"

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): architecture-promote → packages.picking"
    And ".gtd/REQUIREMENTS.md" does not exist
    And ".gtd/packages/01-greeting-export.md" exists

  @live
  Scenario: unwind's real script sweeps a leftover .gtd/ASSUMPTIONS.md an earlier, abandoned process left behind — before this process's own planning phase could ever write one
    Given a test project
    And a commit "chore: leftover from an abandoned process" that adds ".gtd/ASSUMPTIONS.md" with:
      """
      - Which storage backend? → SQLite — not blocking, confidently inferable; skipped without asking (design phase).
      """
    And a file "src/greeter.ts" with:
      """
      export const greet = () => "hi"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"
    And ".gtd/ASSUMPTIONS.md" exists

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"
    And ".gtd/ASSUMPTIONS.md" does not exist

  @live
  Scenario: design.gate.decide's real script — a question already ticked from an earlier lap sits alongside the one judged this round — validates pick-N against the OPEN question's own options and preserves the ticked sibling untouched
    Given a test project
    And a commit "gtd(human): design.gate.screen" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Plan

      Some plan text.

      ## Open Questions

      ### Which storage backend?

      - [x] SQLite
      - [ ] Postgres
      - [ ] _your answer_

      ### Which log level?

      - [ ] info
      - [ ] debug
      - [ ] _your answer_
      """
    And a commit "gtd(human): design.gate.screen" that adds ".gtd/QUESTIONS.md" with:
      """
      open questions remain in .gtd/REQUIREMENTS.md
      """
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "blocking-1", "answer": false, "p": 0.95},
        {"id": "inferable-1", "answer": true, "p": 0.95},
        {"id": "pick-1", "answer": "debug", "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.screen → design.gate.decide"

    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.decide → architecture-pre"
    # "Which storage backend?" was already answered before this round —
    # `screen`/`decide` never judge it (it isn't in `gtd check
    # qa --open-questions`'s own unanswered list, so it gets no
    # blocking-N/inferable-N/pick-N ids at all) — and it survives untouched
    # under "## Open Questions", still ticked.
    And ".gtd/REQUIREMENTS.md" contains "## Open Questions"
    And ".gtd/REQUIREMENTS.md" contains "### Which storage backend?"
    And ".gtd/REQUIREMENTS.md" contains "- [x] SQLite"
    And ".gtd/REQUIREMENTS.md" contains "- [ ] Postgres"
    # "Which log level?" — the one question actually judged this round —
    # moves out of "## Open Questions" entirely, its checkbox options gone,
    # replaced by "debug" as plain prose under "## Answered Questions".
    And ".gtd/REQUIREMENTS.md" contains "## Answered Questions"
    And ".gtd/REQUIREMENTS.md" contains "### Which log level?"
    And ".gtd/REQUIREMENTS.md" does not contain "- [ ] info"
    And ".gtd/REQUIREMENTS.md" does not contain "- [ ] debug"
    And ".gtd/ASSUMPTIONS.md" contains "Which log level? → debug"
    And ".gtd/QUESTIONS.md" does not exist
