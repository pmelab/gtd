@inmem
Feature: The bundled unified workflow — advanced-flow entry and per-package loop

  Coverage of the ADVANCED entry of `src/workflows/unified.yaml` (started by
  creating `.gtd/REQUIREMENTS.md`): the two-phase product/technical Q&A
  (product.author ⇄ answer, technical.author ⇄ answer), package decomposition,
  the per-package build loop (packages.picking → packages.item.building →
  packages.item.health.check), the per-package agentic
  `packages.item.spec.review` gate (issues → packages.item.fix-spec → re-check →
  re-review; clean = approval → packages.item.closing), and the queue closing
  out to the SHARED tail (`review.reviewing`) once every package is done.

  The Q&A phases use the qa checkbox format: the agent surfaces each open
  question with candidate-answer checkboxes plus a `- [ ] _your answer_` slot,
  and the `answerGate` on product.answer/technical.answer refuses a step
  while any open question lacks exactly one tick. Ticking loops back to the
  agent (which folds answers in); a clean step advances only when no open
  questions remain (agent surfaced none, or the human deleted the section).

  Check-actor states (packages.picking, packages.item.health.check,
  packages.item.closing, review.deciding) are
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
    And the last commit subject is "gtd(human): idle → spec-gate.check"

  Scenario: idle forks on the entry file — TODO.md (anything else) starts the simple flow gate
    Given a test project
    And the workflow
    And a file ".gtd/TODO.md" with:
      """
      Build a small thing.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-gate.check"

  Scenario: the answer gate refuses an unanswered open question, then ticking loops back and a converged plan advances
    Given a test project
    And the workflow
    And a commit "gtd(agent): product.answer" that adds ".gtd/REQUIREMENTS.md" with:
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
    # tick exactly one option -> loops back to product.author to fold the answer in
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
    And the last commit subject is "gtd(human): product.answer → product.author"

  Scenario: the accept-all escape — deleting the whole Open Questions section is allowed and loops to the agent to finalize
    Given a test project
    And the workflow
    And a commit "gtd(agent): product.answer" that adds ".gtd/REQUIREMENTS.md" with:
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
    And the last commit subject is "gtd(human): product.answer → product.author"

  Scenario: a ticked free-text slot with text is a valid answer; the placeholder alone is refused
    Given a test project
    And the workflow
    And a commit "gtd(agent): technical.answer" that adds ".gtd/ARCHITECTURE.md" with:
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
    # replace the placeholder with real text -> answered, loops to technical.author
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
    And the last commit subject is "gtd(human): technical.answer → technical.author"

  Scenario: the advanced flow runs product + technical Q&A, decomposes into a package, builds it, fails and passes the spec-review gate, then closes out to review
    Given a test project
    And the workflow
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → spec-gate.check"

    # spec-gate.check: green baseline gate — a clean tree (tests pass) -> product.author
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): spec-gate.check → product.author"

    # product.author: develops the product plan in REQUIREMENTS.md
    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a widget. Product plan: it exposes a `widget()` factory.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): product.author → product.answer"

    # product.answer: accept with a clean step -> technical.author
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): product.answer → technical.author"

    # technical.author: writes ARCHITECTURE.md, deletes REQUIREMENTS.md
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/widget.ts with a factory function.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): technical.author → technical.answer"

    # technical.answer: accept with a clean step -> build.decompose
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): technical.answer → build.decompose"

    # build.decompose: writes one package file, deletes ARCHITECTURE.md
    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory. Independent tasks:
      - [ ] add src/widget.ts
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): build.decompose → packages.picking"

    # packages.picking: takes the first package file into NEXT.md
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → packages.item.building"

    # packages.item.building: implements the package's tasks, leaving the package file
    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.building → packages.item.health.check"

    # packages.item.health.check (green): a clean step moves to the packages.item.spec.review gate
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.review"

    # packages.item.spec.review (issues): the reviewer writes SPEC_FEEDBACK.md -> packages.item.fix-spec
    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      widget() should return a frozen object.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.fix-spec"

    # packages.item.fix-spec: addresses the concern, deletes SPEC_FEEDBACK.md -> packages.item.health.check
    Given the file ".gtd/SPEC_FEEDBACK.md" is deleted
    And "src/widget.ts" is modified to:
      """
      export const widget = () => Object.freeze({})
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.fix-spec → packages.item.health.check"

    # packages.item.health.check (green) -> packages.item.spec.review again
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.health.check → packages.item.spec.review"

    # packages.item.spec.review (clean = approval): the reviewer writes nothing -> packages.item.closing
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"

    # packages.item.closing: removes the reviewed package file and NEXT.md -> packages.picking
    Given the file ".gtd/packages/01-widget.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → packages.picking"

    # packages.picking: the queue is now empty — a clean step closes out to the shared
    # review tail
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → review.reviewing"

    # review.reviewing: writes REVIEW.md and hands to the shared human review gate
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
    And stdout contains "State: review.await-review"

  Scenario: a custom two-level nested machine reference resolves $param bindings and qualified names across both levels
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          leaf:
            params: [onDone]
            entry: work
            states:
              work:
                actor: agent
                prompt: "do the work"
                on:
                  "* **": $onDone
          mid:
            params: [onDone]
            entry: gate
            states:
              gate:
                actor: human
                message: "approve?"
                on:
                  "* **": inner
              inner:
                machine: leaf
                with:
                  onDone: $onDone
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": nested
              nested:
                machine: mid
                with:
                  onDone: done
              done:
                commit: "chore: done"
      """
    And a file "NOTE.md" with:
      """
      kick off
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → nested.gate"

    # root's own idle -> nested resolved through mid's own entry (nested.gate);
    # this step resolves ONE level deeper still, through mid's "inner" reference
    # into leaf's own entry (nested.inner.work) — a two-level qualified name.
    Given a file "NOTE.md" with:
      """
      approved
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): nested.gate → nested.inner.work"
    When I run gtd next
    Then it succeeds
    And stdout contains "do the work"

    # leaf's own $onDone was bound at mid's reference site to mid's OWN
    # $onDone, which was in turn bound at root's reference site to "done" — a
    # param threaded grandparent -> parent -> child resolves in the
    # grandparent's namespace, landing on the commit state two levels up.
    Given a file "NOTE.md" with:
      """
      done
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "chore: done"
