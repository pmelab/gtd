@inmem
Feature: The bundled unified workflow — advanced-flow entry and per-package loop

  Coverage of the ADVANCED entry of `src/workflows/unified.yaml` (started by
  creating `.gtd/REQUIREMENTS.md`): the two-phase product/technical Q&A
  (adv-grilling ⇄ answer, architecting ⇄ answer), package decomposition, the
  per-package build loop (picking → adv-building → adv-checking), the
  per-package agentic `spec-review` gate (issues → spec-fix → re-check →
  re-review; clean = approval → closing), and the queue closing out to the
  SHARED tail (`reviewing`) once every package is done.

  The Q&A phases use the qa checkbox format: the agent surfaces each open
  question with candidate-answer checkboxes plus a `- [ ] _your answer_` slot,
  and the `answerGate` on adv-grilling-answer/architecting-answer refuses a step
  while any open question lacks exactly one tick. Ticking loops back to the
  agent (which folds answers in); a clean step advances only when no open
  questions remain (agent surfaced none, or the human deleted the section).

  Check-actor states (picking, adv-checking, closing, review-deciding) are
  simulated by writing their verdict files directly and running
  `gtd step check` — @inmem never executes the scripts themselves.

  Scenario: idle forks on the entry file — REQUIREMENTS.md starts the advanced flow gate
    Given a test project
    And the workflow
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget with product requirements.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → adv-start-check"

  Scenario: idle forks on the entry file — TODO.md (anything else) starts the simple flow gate
    Given a test project
    And the workflow
    And a file ".gtd/TODO.md" with:
      """
      Build a small thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → start-check"

  Scenario: the answer gate refuses an unanswered open question, then ticking loops back and a converged plan advances
    Given a test project
    And the workflow
    And a commit "gtd(agent): adv-grilling-answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    # answerGate: stepping with no tick is refused, nothing committed
    When I run gtd step human
    Then it fails
    And stderr contains "not answered"
    And stderr contains "Which storage backend?"
    # tick exactly one option -> loops back to adv-grilling to fold the answer in
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [x] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): adv-grilling-answer → adv-grilling"

  Scenario: the accept-all escape — deleting the whole Open Questions section is allowed and loops to the agent to finalize
    Given a test project
    And the workflow
    And a commit "gtd(agent): adv-grilling-answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite
      - [ ] Postgres
      - [ ] _your answer_
      """
    # delete the whole Open Questions section — accept-all, no unanswered question remains
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): adv-grilling-answer → adv-grilling"

  Scenario: a ticked free-text slot with text is a valid answer; the placeholder alone is refused
    Given a test project
    And the workflow
    And a commit "gtd(agent): architecting-answer" that adds ".gtd/ARCHITECTURE.md" with:
      """
      Modules: widget.ts, store.ts.

      ## Open Questions

      ### ORM or raw SQL?

      - [ ] Prisma
      - [ ] raw SQL
      - [x] _your answer_
      """
    # free-text slot ticked but still the placeholder -> refused
    When I run gtd step human
    Then it fails
    And stderr contains "not answered"
    # replace the placeholder with real text -> answered, loops to architecting
    Given ".gtd/ARCHITECTURE.md" is modified to:
      """
      Modules: widget.ts, store.ts.

      ## Open Questions

      ### ORM or raw SQL?

      - [ ] Prisma
      - [ ] raw SQL
      - [x] Drizzle — typed, lightweight
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): architecting-answer → architecting"

  Scenario: the advanced flow runs product + technical Q&A, decomposes into a package, builds it, fails and passes the spec-review gate, then closes out to review
    Given a test project
    And the workflow
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → adv-start-check"

    # adv-start-check: green baseline gate — a clean tree (tests pass) -> adv-grilling
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): adv-start-check → adv-grilling"

    # adv-grilling: develops the product plan in REQUIREMENTS.md
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget. Product plan: it exposes a `widget()` factory.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): adv-grilling → adv-grilling-answer"

    # adv-grilling-answer: accept with a clean step -> architecting
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): adv-grilling-answer → architecting"

    # architecting: writes ARCHITECTURE.md, deletes REQUIREMENTS.md
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/widget.ts with a factory function.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): architecting → architecting-answer"

    # architecting-answer: accept with a clean step -> decompose
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): architecting-answer → decompose"

    # decompose: writes one package file, deletes ARCHITECTURE.md
    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): decompose → picking"

    # picking: takes the first package file into NEXT.md
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): picking → adv-building"

    # adv-building: implements the package's tasks, leaving the package file
    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): adv-building → adv-checking"

    # adv-checking (green): a clean step moves to the spec-review gate
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): adv-checking → spec-review"

    # spec-review (issues): the reviewer writes SPEC_FEEDBACK.md -> spec-fix
    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      widget() should return a frozen object.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): spec-review → spec-fix"

    # spec-fix: addresses the concern, deletes SPEC_FEEDBACK.md -> adv-checking
    Given the file ".gtd/SPEC_FEEDBACK.md" is deleted
    And "src/widget.ts" is modified to:
      """
      export const widget = () => Object.freeze({})
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): spec-fix → adv-checking"

    # adv-checking (green) -> spec-review again
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): adv-checking → spec-review"

    # spec-review (clean = approval): the reviewer writes nothing -> closing
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): spec-review → closing"

    # closing: removes the reviewed package file and NEXT.md -> picking
    Given the file ".gtd/packages/01-widget.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): closing → picking"

    # picking: the queue is now empty — a clean step closes out to the shared
    # review tail
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): picking → reviewing"

    # reviewing: writes REVIEW.md and hands to the shared human review gate
    # (the tail from here — sign-off into the squash finale — is shared with the
    # simple flow, exercised in default-workflow.feature)
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Widget

      - [ ] ./src/widget.ts#1 — new factory
      """
    When I run gtd step agent
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    When I run gtd status
    Then it succeeds
    And stdout contains "State: await-review"
