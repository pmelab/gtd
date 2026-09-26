Feature: specReview's pre-judge (.gtd/packages/02-spec-review-judgments.md)

  `packages.item.spec.pre` renders one `noul` per `## ` section of the
  package the current build is judged against. Each scenario reaches it
  by the shortest real history: `--entry start-gate.check`, a one-line
  triage, `architecture-pre` judged "no" so `architecture-promote` turns
  the plan straight into the one package under test, then picking,
  building and a green health check. `scoping`'s own shell body is a workflow-authored
  script a real DRIVER runs (never this test harness, same convention every
  other `actor: check` state's script uses here) — its effect is given by
  hand, the way `packages.item.health.check`'s own script output already is
  elsewhere in this suite.

  There is no post-judge over the review's findings: `review` owns the
  severity bar itself and a round that finds only nits writes nothing, so
  the last scenario pins that a written `.gtd/SPEC_FEEDBACK.md` goes
  straight to `fix-spec` with every finding intact.

  @inmem
  Scenario: a skipped judgment (no verdict) always runs the full review — the fail-open default, even for a package with no `## ` sections at all
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.scoping → packages.item.spec.review"
    And ".gtd/SPEC_SCOPE.md" does not exist

  @inmem
  Scenario: every section answered high-confidence "yes" clears at the scoping check, no review turn spent
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts

      ## Section B
      - [ ] add src/b.ts

      ## Section C
      - [ ] add src/c.ts
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "section-1", "answer": true, "p": 0.95},
        {"id": "section-2", "answer": true, "p": 0.95},
        {"id": "section-3", "answer": true, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"

    # scoping's own script (a real DRIVER's job, not this harness's) finds
    # every real section answered and confident — given by hand here, same
    # convention as the rest of this feature.
    Given a file ".gtd/SPEC_CLEARED.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.scoping → packages.item.closing"
    And the git log does not contain "packages.item.spec.review"

  @inmem
  Scenario: only one of three sections answered — a partial verdict never approves; the unanswered sections default to failing
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts

      ## Section B
      - [ ] add src/b.ts

      ## Section C
      - [ ] add src/c.ts
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "section-1", "answer": true, "p": 0.99}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"

    # sections 2 and 3 were never judged — scoping must scope the reviewer
    # to them, never approve on section-1 alone.
    Given a file ".gtd/SPEC_SCOPE.md" with:
      """
      - Section B
      - Section C
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.scoping → packages.item.spec.review"

  @inmem
  Scenario: two of three sections answered "no"/low-confidence route to the scoping check, which confines the reviewer to exactly those two
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts

      ## Section B
      - [ ] add src/b.ts

      ## Section C
      - [ ] add src/c.ts
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    # Dereferences the pointer: the judge's own evidence is the package
    # markdown itself, never the literal ".gtd/packages/01-widget.md" text
    # `.gtd/NEXT.md` holds.
    When I run gtd with args "judge"
    Then it succeeds
    And stdout contains "Section A"
    And stdout contains "Section B"
    And stdout contains "Section C"
    And stdout does not contain ".gtd/packages/01-widget.md"

    When I run gtd judge answer with stdin:
      """
      [
        {"id": "section-1", "answer": false, "p": 0.9},
        {"id": "section-2", "answer": false, "p": 0.9},
        {"id": "section-3", "answer": true, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"

    # scoping's own script (a real DRIVER's job, not this harness's) maps the
    # just-landed Gtd-Judge trailers' failing ids back to section titles —
    # given by hand here, the same convention `default-workflow.feature`
    # uses for `packages.item.health.check`'s own script output.
    Given a file ".gtd/SPEC_SCOPE.md" with:
      """
      - Section A
      - Section B
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.scoping → packages.item.spec.review"
    When I run gtd next
    Then it succeeds
    And stdout contains "Section A"
    And stdout contains "Section B"
    And stdout does not contain "Section C"

  @inmem
  Scenario: a written .gtd/SPEC_FEEDBACK.md routes straight to fix-spec with every finding intact — no post-judge re-weighs them
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"
    And gtd lands "gtd(check): packages.item.spec.scoping → packages.item.spec.review"
    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      ## Missing null check

      src/a.ts#12 never guards against a null input, contradicting the spec.

      ## Unhandled empty list

      src/a.ts#20 throws on the empty input the criteria name.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.fix-spec"
    And ".gtd/SPEC_FEEDBACK.md" contains "Missing null check"
    And ".gtd/SPEC_FEEDBACK.md" contains "Unhandled empty list"

  @inmem
  Scenario: a review that writes no .gtd/SPEC_FEEDBACK.md approves the package outright — silence is the only approval
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget factory. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      export const widget = 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.scoping"
    And gtd lands "gtd(check): packages.item.spec.scoping → packages.item.spec.review"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"
    And ".gtd/SPEC_FEEDBACK.md" does not exist
