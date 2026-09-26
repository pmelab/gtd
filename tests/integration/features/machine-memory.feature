@inmem
Feature: Machine-scoped memory — a computed <scope>#<hash> key, not an authored label

  The bundled workflow's memory key is COMPUTED from a `prompt`-content
  step's memory scope, never authored per step: the scope is the step name's
  `scope()` prefix (`""` for the root, `"build"`, `"build.health"`,
  `"packages.item"`, `"packages.item.spec"`, ...), and the key is
  `<scope>#<hash7>` — the first 7 hex characters of the commit the CURRENT
  unbroken run into that scope started FROM. Entering a DESCENDANT scope (a
  true dotted-prefix match) doesn't break the ancestor's run; entering a
  sibling or unrelated scope does. These scenarios pin that end to end, via
  `gtd next --json`'s `.memory` field, against the REAL bundled workflow
  (`src/workflows/unified.ts`), each reaching its steps by a real landed
  history — not a synthetic config, since the whole point is the SHAPE of
  the actual shipped scopes.

  Scenario: memory is retained across a machine's own laps — design.triage resumes across a design.gate.answer turn in between
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And I record the json field "memory" as "first lap"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And a file ".gtd/QUESTIONS.md" with:
      """
      open questions remain in .gtd/REQUIREMENTS.md
      """
    And gtd lands "gtd(check): design.gate.check → design.gate.answer"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.gate.answer\""
    And stdout does not contain "\"memory\""

    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a thing.

      ## Open Questions

      ### Which storage backend?

      - [x] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    And gtd lands "gtd(human): design.gate.answer → design.triage"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And the json field "memory" matches the one recorded as "first lap"

  Scenario: memory is retained across an excursion into a child machine's own check/escalate/describe/stop — build.fix resumes across the whole detour
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "first fix attempt"

    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/widget.ts" with:
      """
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.check\""
    And stdout does not contain "\"memory\""

    # Two identical red rounds: the judge calls the second one "identical",
    # escalating ahead of the fix cap.
    Given a file ".gtd/FEEDBACK.md" with:
      """
      test failed again: widget() still returns undefined
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/widget.ts" with:
      """
      export const widget = () => null
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed again: widget() still returns undefined
      """
    And gtd lands "gtd(check): build.health.check → build.health.judge"
    And gtd lands "gtd(judge): build.health.judge → build.health.describe" judging:
      """
      [{"id": "verdict", "answer": "identical", "p": 0.95}]
      """

    # build.health.describe is a real `prompt` state — its own memory key,
    # scoped to build.health (the healthGate instance), distinct from
    # build.fix's own "build"-scoped key recorded above.
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.describe\""
    And the json field "memory" differs from the one recorded as "first fix attempt"
    And I record the json field "memory" as "the escalation turn"

    Given a file ".gtd/ESCALATION.md" with:
      """
      what's failing, why the earlier attempts didn't resolve it, and a
      suggested approach
      """
    And gtd lands "gtd(agent): build.health.describe → build.health.stop"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.stop\""
    And stdout does not contain "\"memory\""

    # The human lands the escalation document untouched, handing it to the
    # next fix turn.
    Given gtd lands "gtd(human): build.health.stop → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And the json field "memory" matches the one recorded as "first fix attempt"
    And the json field "memory" differs from the one recorded as "the escalation turn"

  Scenario: memory is retained across a CHILD's own full agent turn, and that child's own session is never confused with the caller's — packages.item.building ⇄ packages.item.spec.review ⇄ packages.item.fix-spec
    # The sharpest case, and the one the old "last label" driver design (before
    # package 07's per-scope table) got wrong: a full AGENT turn in a nested
    # child machine (packages.item.spec, ▸ planner) sits between two turns of
    # the caller (packages.item, ▸ coder) — the caller's session must survive
    # it untouched, and the child's own session must never be confused with
    # the caller's either.
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget. No open questions.
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
      Package: the widget.
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And I record the json field "memory" as "the builder's turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.spec.review\""
    And the json field "memory" differs from the one recorded as "the builder's turn"
    And I record the json field "memory" as "the reviewer's turn"

    Given a file ".gtd/SPEC_FEEDBACK.md" with:
      """
      widget() should return a frozen object.
      """
    And gtd lands "gtd(agent): packages.item.spec.review → packages.item.fix-spec"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.fix-spec\""
    And the json field "memory" matches the one recorded as "the builder's turn"
    And the json field "memory" differs from the one recorded as "the reviewer's turn"

  Scenario: a fresh memory key per entry — two different packages each get their own distinct session at packages.item.building
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget and the gadget. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: one module each. No open questions.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.check"
    And gtd lands "gtd(check): architecture.gate.check → architecture.decompose"
    And the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget.
      """
    And a file ".gtd/packages/02-gadget.md" with:
      """
      Package: the gadget.
      """
    And gtd lands "gtd(agent): architecture.decompose → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "memory" as "package 1's builder turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    # A clean review turn is the approval.
    And gtd lands "gtd(agent): packages.item.spec.review → packages.item.closing"
    And the file ".gtd/packages/01-widget.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    And gtd lands "gtd(check): packages.item.closing → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/02-gadget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And the json field "memory" differs from the one recorded as "package 1's builder turn"

  Scenario: two instances of one healthGate-shaped machine never share a session, even with byte-identical check output
    Given a test project
    And the workflow
    # build.health and packages.item.health are both healthGate instances at
    # different points in the tree (src/workflows/unified.ts) — the proof
    # below is that their computed memory keys never collide, even though
    # both land byte-identical FEEDBACK.md check output.

    Given an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"build#[0-9a-f]{7}\""

    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/widget.ts" with:
      """
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1
      new export
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — deciding
    # captures it straight into the raw capture (given by hand).
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    And the file ".gtd/REVIEW.md" is deleted
    And a file ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.

      Commit: deadbeef
      """
    And gtd lands "gtd(check): build.review.deciding → build.review.collecting"
    # collecting judges the round actionable; re-unwind reverts the
    # hand-edit, and the whole plan is re-derived from scratch.
    And the file ".gtd/REVIEW_RAW.md" is deleted
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Doc comment

      Add a doc comment above the widget export.
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    And the file "src/greet.ts" is deleted
    And gtd lands "gtd(check): re-unwind → design.triage"
    And ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Doc comment

      Add a doc comment above the widget export. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-doc-comment.md" with:
      """
      Package: add a doc comment above the widget export.
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-doc-comment.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): packages.item.health.check → packages.item.fix-suite"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"packages\.item#[0-9a-f]{7}\""

  Scenario: a reviewer turn never resumes an implementer session, even though both are prompt-content machine instances active around the same point in the trace
    # packages.item.spec (▸ planner) and packages.item (▸ coder) are adjacent
    # in the trace below — a builder turn immediately followed by a reviewer
    # turn — yet their computed keys never share a scope prefix.
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget. No open questions.
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
      Package: the widget.
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"packages\.item#[0-9a-f]{7}\""

    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"packages\.item\.spec#[0-9a-f]{7}\""
    And stdout does not contain "\"memory\":\"packages.item#"

  Scenario: build.review's own session survives the deciding hop into an actionable round — reviewing and collecting share the session
    # humanReview is nested INSIDE buildTail (`build.review`), not a root
    # sibling — a descendant scope doesn't break the parent's run, so dipping
    # into the review tail's own scope never breaks build's own unbroken run
    # (build.fix differs from build.review.reviewing below, proving the
    # descent gets its own key). Within "build.review" itself, `deciding` is
    # a `check`-content state (no memory of its own — see the "does not
    # contain memory" assertion) that sits between `reviewing` and
    # `collecting` on an actionable round: this pins that the reviewer's own
    # session survives that script-only hop unbroken. (A clean sign-off now
    # lands directly on `idle`, the root's own initial state — there is no
    # more `build`-scope state past `deciding` for a builder's session to
    # resume at; see default-workflow.feature's own sign-off scenarios.)
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "the builder's turn"

    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/widget.ts" with:
      """
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.check\""
    And stdout does not contain "\"memory\""

    Given gtd lands "gtd(check): build.health.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And the json field "memory" differs from the one recorded as "the builder's turn"
    And I record the json field "memory" as "the reviewer's turn"

    # This scenario never queries `gtd next` at `await-review` or
    # `deciding` — it only lands their turns and moves straight on to
    # `collecting`, which is where the assertions resume.
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1
      new export
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — deciding
    # captures it straight into the raw capture (given by hand).
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    And the file ".gtd/REVIEW.md" is deleted
    And a file ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.

      Commit: deadbeef
      """
    And gtd lands "gtd(check): build.review.deciding → build.review.collecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.collecting\""
    And the json field "memory" matches the one recorded as "the reviewer's turn"

  Scenario: a fresh reviewer session per round — the sibling break at build.health.check gives each review round a new mind
    # build.review.reviewing's own scope ("build.review") is a descendant of
    # "build", so it never breaks the BUILDER's run (previous scenario) — but
    # the reviewer's OWN run breaks every round it's re-entered through a
    # sibling or an unrelated scope. An actionable feedback round breaks it
    # even more decisively than before: getting back to
    # build.review.reviewing now passes all the way out through the root's
    # own `re-unwind` and a full design/architecture/packages lap, none of
    # which are descendants of `build.review`. Two rounds of review over the
    # same feature are therefore always reviewed with fresh eyes.
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/widget.ts" with:
      """
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And I record the json field "memory" as "round 1's reviewer turn"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1
      new export
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — deciding
    # captures it straight into the raw capture (given by hand).
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    And the file ".gtd/REVIEW.md" is deleted
    And a file ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.

      Commit: deadbeef
      """
    And gtd lands "gtd(check): build.review.deciding → build.review.collecting"
    # collecting judges the round actionable; re-unwind reverts the
    # hand-edit, and the whole plan is re-derived from scratch.
    And the file ".gtd/REVIEW_RAW.md" is deleted
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Doc comment

      Add a doc comment above the widget export.
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    And the file "src/greet.ts" is deleted
    And gtd lands "gtd(check): re-unwind → design.triage"
    And ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Doc comment

      Add a doc comment above the widget export. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-doc-comment.md" with:
      """
      Package: add a doc comment above the widget export.
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-doc-comment.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    And gtd lands "gtd(agent): packages.item.spec.review → packages.item.closing"
    And the file ".gtd/packages/01-doc-comment.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    And gtd lands "gtd(check): packages.item.closing → packages.picking"
    And gtd lands "gtd(check): packages.picking → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And the json field "memory" differs from the one recorded as "round 1's reviewer turn"

  Scenario: an actionable loop-back round breaks build's OWN run too — the post-loop-back reviewer turn never resumes the pre-loop-back builder
    # `build.fix` and `build.review.reviewing` are different scopes ("build"
    # vs. "build.review") — a plain descendant dip from "build" into
    # "build.review" never breaks build's own run (see the previous
    # scenario), but the re-unwind/design/architecture/packages rows an
    # ACTIONABLE round takes are none of them descendants of "build" either.
    # So the SAME break that gives the reviewer a fresh mind each round
    # (previous scenario) also breaks the builder's own run: by the time the
    # loop-back's own package lands, the second pass's build.review.reviewing
    # is anchored at THIS pass's own entry into the shared tail, never the
    # original build.fix turn from before the round-trip.
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "the pre-loop-back builder's turn"

    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/widget.ts" with:
      """
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1
      new export
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — deciding
    # captures it straight into the raw capture (given by hand).
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    And the file ".gtd/REVIEW.md" is deleted
    And a file ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.

      Commit: deadbeef
      """
    And gtd lands "gtd(check): build.review.deciding → build.review.collecting"
    # collecting judges the round actionable; re-unwind reverts the
    # hand-edit, and the whole plan is re-derived from scratch.
    And the file ".gtd/REVIEW_RAW.md" is deleted
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Doc comment

      Add a doc comment above the widget export.
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    And the file "src/greet.ts" is deleted
    And gtd lands "gtd(check): re-unwind → design.triage"
    And ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Doc comment

      Add a doc comment above the widget export. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    And gtd lands "gtd(judge): architecture-pre → architecture-promote" judging:
      """
      [{"id": "architectureWarranted", "answer": false, "p": 0.95}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/packages/01-doc-comment.md" with:
      """
      Package: add a doc comment above the widget export.
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    And a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-doc-comment.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    And a file "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    And gtd lands "gtd(agent): packages.item.spec.review → packages.item.closing"
    And the file ".gtd/packages/01-doc-comment.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    And gtd lands "gtd(check): packages.item.closing → packages.picking"
    And gtd lands "gtd(check): packages.picking → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And the json field "memory" differs from the one recorded as "the pre-loop-back builder's turn"

  Scenario: gtd --entry fix-precheck's own build.fix session survives into the shared review tail — reviewing and collecting share the session even on the fix-precheck entry
    # The nesting's whole remaining point: on this entry, build.fix opens
    # build's own scope directly (no packages/design/architecture lap ever
    # runs), and every state from there to build.review.* —
    # build.fix -> build.health.check -> build.review.reviewing -> ... —
    # stays inside that one subtree, so the review is drafted by the SAME
    # session that made the fixes; the reviewer's own session then survives
    # the deciding hop into collecting on an actionable round, exactly as the
    # earlier scenario shows for the normal (unwind) entry. The first assertion
    # below proves the "build" half of that claim directly: a still-red check
    # loops build.fix back into itself (health.check -> fix, under the retry
    # cap) without leaving the "build" scope, so its second entry's memory
    # must match its first — the same claim
    # "memory is retained across an excursion into a child machine's own
    # check" makes for the ordinary (unwind) entry, pinned here specifically
    # for the fix-precheck entry, since that's the one route where
    # build.fix opens the scope directly rather than resuming it.
    Given a test project
    And the workflow
    # Blanks the queue so a green health check hands straight to the human
    # review tail — the quality lap itself is covered in its own feature.
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"

    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): fix-precheck → build.fix"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "the fix-precheck path's fix turn"

    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/attempt-1.ts" with:
      """
      // a first repair attempt that still fails the check
      export const attempt = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"

    Given a file ".gtd/FEEDBACK.md" with:
      """
      1 test still failing
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.fix"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And the json field "memory" matches the one recorded as "the fix-precheck path's fix turn"

    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/repair.ts" with:
      """
      export const repaired = true
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.seeding"

    # Blank GTD_QUALITYREVIEWS empties the queue — seeding's own clean tree
    # hands straight on to the human review tail.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.review.reviewing"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And I record the json field "memory" as "the fix-precheck path's reviewer turn"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Repair

      - [ ] ./src/repair.ts#1
      new export
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — deciding
    # captures it straight into the raw capture (given by hand).
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.deciding"
    And the file ".gtd/REVIEW.md" is deleted
    And a file ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.

      Commit: deadbeef
      """
    And gtd lands "gtd(check): build.review.deciding → build.review.collecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.collecting\""
    And the json field "memory" matches the one recorded as "the fix-precheck path's reviewer turn"

  Scenario: architecture is a separate memory scope from design, but its own Q&A and decomposition share one session
    # design (designPlan) and architecture (archPlan) are sibling machines with
    # their own memory scope each — a deliberate handover, not one fused
    # conversation, since the technical phase reads the requirements file cold
    # rather than resuming design's own session. Within architecture's own
    # scope, though, the human's answer rationale survives from the Q&A turn
    # into decomposition, exactly as design's own laps resume each other.
    Given a test project
    And the workflow
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And I record the json field "memory" as "the design conversation's turn"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget. No open questions.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.check"
    And gtd lands "gtd(check): design.gate.check → architecture-pre"
    # No verdict piped: the conservative default runs the full pass.
    And gtd lands "gtd(judge): architecture-pre → architecture.author"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"architecture.author\""
    And the json field "memory" differs from the one recorded as "the design conversation's turn"
    And I record the json field "memory" as "the architecture conversation's first turn"

    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the widget.

      ## Open Questions

      ### Which storage backend?

      - [ ] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.check"
    And a file ".gtd/QUESTIONS.md" with:
      """
      open questions remain in .gtd/ARCHITECTURE.md
      """
    And gtd lands "gtd(check): architecture.gate.check → architecture.gate.answer"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"architecture.gate.answer\""
    And stdout does not contain "\"memory\""

    # The human answers; the author folds the answer in, and with no open
    # question left the gate hands on to decomposition.
    Given ".gtd/ARCHITECTURE.md" is modified to:
      """
      Technical plan for the widget.

      ## Open Questions

      ### Which storage backend?

      - [x] SQLite — zero-config, file-based
      - [ ] Postgres — for concurrent writers
      - [ ] _your answer_
      """
    And gtd lands "gtd(human): architecture.gate.answer → architecture.author"
    And ".gtd/ARCHITECTURE.md" is modified to:
      """
      Technical plan for the widget.

      ## Answered Questions

      ### Which storage backend?

      SQLite — zero-config, file-based.
      """
    And gtd lands "gtd(agent): architecture.author → architecture.gate.check"
    And the file ".gtd/QUESTIONS.md" is deleted
    And gtd lands "gtd(check): architecture.gate.check → architecture.decompose"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"architecture.decompose\""
    And the json field "memory" matches the one recorded as "the architecture conversation's first turn"

  Scenario: the per-package build queue gets a fresh reviewer session at the shared tail, distinct from any package's own session
    # The per-package build queue (packages.*) closes out into the shared tail
    # (build.review.*) — that tail opens a fresh `build.review#...` session
    # there, never resuming any package's own `packages.item#...` session.
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget. No open questions.
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
      Package: the widget.
      """
    And gtd lands "gtd(check): architecture-promote → packages.picking"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.picking\""

    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    And gtd lands "gtd(check): packages.picking → packages.item.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And stdout matches "\"memory\":\"packages\.item#[0-9a-f]{7}\""
    And I record the json field "memory" as "the package builder's turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    And gtd lands "gtd(agent): packages.item.building → packages.item.health.check"
    And gtd lands "gtd(check): packages.item.health.check → packages.item.spec.pre"
    And gtd lands "gtd(judge): packages.item.spec.pre → packages.item.spec.review"
    And gtd lands "gtd(agent): packages.item.spec.review → packages.item.closing"
    And the file ".gtd/packages/01-widget.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    And gtd lands "gtd(check): packages.item.closing → packages.picking"
    And gtd lands "gtd(check): packages.picking → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And the json field "memory" differs from the one recorded as "the package builder's turn"

  Scenario: two agent steps in one memory scope with different models refuse to land — one scope is one conversation, with one model
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "start" })
        await agent("draft", "draft it", { model: "smart" })
        await agent("refine", "refine it", { model: "fast" })
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → draft"
    And a file "DRAFT.md" with:
      """
      a draft
      """
    When I run gtd land
    Then it fails
    And stderr contains "runs with a different model or system prompt"
    And stderr contains "one scope is one conversation"

  Scenario: a step-level "memory:" option is rejected at load time — the scope is computed, so there is no authored label to honour or ignore
    # `memory:` is gone OUTRIGHT, with no replacement key, so a config that
    # still declares one is a load error pointing at the new rule — never a
    # silently ignored key that reads as if the authored scope were still in
    # effect.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await agent("working", "go", { memory: "plan" })
      })
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "unknown key"
    And stderr contains "memory"
    And stderr contains "no longer exists"
