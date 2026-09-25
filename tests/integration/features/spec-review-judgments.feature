Feature: specReview's pre-judge (.gtd/packages/02-spec-review-judgments.md)

  `packages.spec.pre` renders one `noul` per `## ` section of the
  package the current build is judged against. It is entered directly here
  (a fabricated commit history, exactly `machine-memory.feature`'s
  technique) rather than walked through triage/architecture/`packages`'s own
  `each:` loop — the states under test don't care how the process got there,
  only what a landed verdict does next. The entering commit carries its own
  `Gtd-Each: packages [...]` snapshot (the same trailer a real `gtd land`
  through `packages`'s own each: loop would write), so `it.item` resolves to
  the real package path. `scoping`'s own shell body is a workflow-authored
  script a real DRIVER runs (never this test harness, same convention every
  other `actor: check` state's script uses here) — its effect is given by
  hand, the way `packages.health.check`'s own script output already is
  elsewhere in this suite.

  There is no post-judge over the review's findings: `review` owns the
  severity bar itself and a round that finds only nits writes nothing, so
  the last scenario pins that a written `.gtd/SPEC_FEEDBACK.md` goes
  straight to `fix-spec` with every finding intact.

  @inmem
  Scenario: a skipped judgment (no verdict) always runs the full review — the fail-open default, even for a package with no `## ` sections at all
    Given a test project
    And the workflow
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    And an empty commit "gtd(check): packages-sweep → packages[0].spec.pre\n\nGtd-Each: packages [\".gtd/packages/01-widget.md\"]"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): packages[0].spec.pre → packages[0].spec.scoping"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages[0].spec.scoping → packages[0].spec.review"
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
    And an empty commit "gtd(check): packages-sweep → packages[0].spec.pre\n\nGtd-Each: packages [\".gtd/packages/01-widget.md\"]"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "section-1", "answer": true, "p": 0.95},
        {"id": "section-2", "answer": true, "p": 0.95},
        {"id": "section-3", "answer": true, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages[0].spec.pre → packages[0].spec.scoping"

    # scoping's own script (a real DRIVER's job, not this harness's) finds
    # every real section answered and confident — given by hand here, same
    # convention as the rest of this feature.
    Given a file ".gtd/SPEC_CLEARED.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages[0].spec.scoping → packages[0].closing"
    And the git log does not contain "packages[0].spec.review"

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
    And an empty commit "gtd(check): packages-sweep → packages[0].spec.pre\n\nGtd-Each: packages [\".gtd/packages/01-widget.md\"]"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "section-1", "answer": true, "p": 0.99}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): packages[0].spec.pre → packages[0].spec.scoping"

    # sections 2 and 3 were never judged — scoping must scope the reviewer
    # to them, never approve on section-1 alone.
    Given a file ".gtd/SPEC_SCOPE.md" with:
      """
      - Section B
      - Section C
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages[0].spec.scoping → packages[0].spec.review"

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
    And an empty commit "gtd(check): packages-sweep → packages[0].spec.pre\n\nGtd-Each: packages [\".gtd/packages/01-widget.md\"]"
    # Dereferences the pointer: the judge's own evidence is the package
    # markdown itself, never a literal ".gtd/packages/01-widget.md" text —
    # `it.item` is a template accessor, not a state file, so there is no
    # pointer text to leak here either.
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
    And the last commit subject is "gtd(judge): packages[0].spec.pre → packages[0].spec.scoping"

    # scoping's own script (a real DRIVER's job, not this harness's) maps the
    # just-landed Gtd-Judge trailers' failing ids back to section titles —
    # given by hand here, the same convention `default-workflow.feature`
    # uses for `packages.health.check`'s own script output.
    Given a file ".gtd/SPEC_SCOPE.md" with:
      """
      - Section A
      - Section B
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages[0].spec.scoping → packages[0].spec.review"
    When I run gtd next
    Then it succeeds
    # The prompt's own "package spec" bullet always inlines the WHOLE
    # package (Section C included — `it.read(it.item)`, same accessor
    # `building`'s own prompt uses); scoping narrows the REVIEW itself, via
    # its own follow-up bullet, never what's printed as the spec.
    And stdout contains "only these sections"
    And stdout contains "- Section A"
    And stdout contains "- Section B"

  @inmem
  Scenario: a written .gtd/SPEC_FEEDBACK.md routes straight to fix-spec with every finding intact — no post-judge re-weighs them
    Given a test project
    And the workflow
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts
      """
    And an empty commit "gtd(agent): packages-sweep → packages[0].spec.review\n\nGtd-Each: packages [\".gtd/packages/01-widget.md\"]"
    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      ## Missing null check

      src/a.ts#12 never guards against a null input, contradicting the spec.

      ## Unhandled empty list

      src/a.ts#20 throws on the empty input the criteria name.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages[0].spec.review → packages[0].fix-spec"
    And ".gtd/SPEC_FEEDBACK.md" contains "Missing null check"
    And ".gtd/SPEC_FEEDBACK.md" contains "Unhandled empty list"

  @inmem
  Scenario: a review that writes no .gtd/SPEC_FEEDBACK.md approves the package outright — silence is the only approval
    Given a test project
    And the workflow
    And a commit "chore: add the package" that adds ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.

      ## Section A
      - [ ] add src/a.ts
      """
    And an empty commit "gtd(agent): packages-sweep → packages[0].spec.review\n\nGtd-Each: packages [\".gtd/packages/01-widget.md\"]"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages[0].spec.review → packages[0].closing"
    And ".gtd/SPEC_FEEDBACK.md" does not exist

    # packages[0].closing: the only package's own file goes with it — the
    # queue drains for real (a single-item snapshot), so `each:`'s own
    # `drained:` target stands, straight into the shared review tail.
    Given the file ".gtd/packages/01-widget.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages[0].closing → build.quality-gate"
