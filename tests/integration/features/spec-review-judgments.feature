Feature: specReview's pre-judge and finding post-judge (.gtd/packages/02-spec-review-judgments.md)

  `packages.item.spec.pre` renders one `noul` per `## ` section of the
  package the current build is judged against; `packages.item.spec.striking`
  renders one `noul` per `## ` finding in a fresh review's own
  `.gtd/SPEC_FEEDBACK.md`. Both are entered directly here (a fabricated
  commit history, exactly `machine-memory.feature`'s technique) rather than
  walked through triage/architecture — the states under test don't care how
  the process got there, only what a landed verdict does next. `scoping`'s
  and `striking`'s own shell bodies are workflow-authored scripts a real
  DRIVER runs (never this test harness, same convention every other
  `actor: check` state's script uses here) — their effect is given by hand,
  the way `packages.item.health.check`'s own script output already is
  elsewhere in this suite.

  @inmem
  Scenario: a skipped judgment (no verdict) always runs the full review — the fail-open default, even for a package with no `## ` sections at all
    Given a test project
    And the workflow
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    And a commit "gtd(check): packages.item.spec.pre" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
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
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts

      ## Section B
      - [ ] add src/b.ts

      ## Section C
      - [ ] add src/c.ts
      """
    And a commit "gtd(check): packages.item.spec.pre" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
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
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts

      ## Section B
      - [ ] add src/b.ts

      ## Section C
      - [ ] add src/c.ts
      """
    And a commit "gtd(check): packages.item.spec.pre" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
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
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts

      ## Section B
      - [ ] add src/b.ts

      ## Section C
      - [ ] add src/c.ts
      """
    And a commit "gtd(check): packages.item.spec.pre" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
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
  Scenario: one of three review findings survives the post-judge — fix-spec runs with exactly that finding
    Given a test project
    And the workflow
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts
      """
    And a commit "chore: point at the package" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And an empty commit "gtd(agent): packages.item.spec.review"
    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      ## Missing null check

      src/a.ts#12 never guards against a null input, contradicting the spec.

      ## Prefer const

      src/a.ts#20 uses `let` where the value is never reassigned.

      ## Extra blank line

      src/a.ts#30 has a stray blank line.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.spec.findingJudge"

    When I run gtd judge answer with stdin:
      """
      [
        {"id": "finding-1", "answer": true, "p": 0.95},
        {"id": "finding-2", "answer": false, "p": 0.9},
        {"id": "finding-3", "answer": false, "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.findingJudge → packages.item.spec.striking"

    # striking's own script strikes the two low-confidence findings from
    # `.gtd/SPEC_FEEDBACK.md` — given by hand, same convention as `scoping`
    # above.
    Given ".gtd/SPEC_FEEDBACK.md" is modified to:
      """
      ## Missing null check

      src/a.ts#12 never guards against a null input, contradicting the spec.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.striking → packages.item.fix-spec"
    And ".gtd/SPEC_FEEDBACK.md" exists
    And ".gtd/SPEC_FEEDBACK.md" contains "Missing null check"
    And ".gtd/SPEC_FEEDBACK.md" does not contain "Prefer const"
    And ".gtd/SPEC_FEEDBACK.md" does not contain "Extra blank line"

  @inmem
  Scenario: every review finding struck by the post-judge closes the package with no fix-spec turn
    Given a test project
    And the workflow
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts
      """
    And a commit "chore: point at the package" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And an empty commit "gtd(agent): packages.item.spec.review"
    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      ## A stylistic nit

      Purely cosmetic, never asked for by the spec.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.spec.findingJudge"

    When I run gtd judge answer with stdin:
      """
      [
        {"id": "finding-1", "answer": false, "p": 0.9}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages.item.spec.findingJudge → packages.item.spec.striking"

    Given the file ".gtd/SPEC_FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.spec.striking → packages.item.closing"
    And ".gtd/SPEC_FEEDBACK.md" does not exist
