@inmem
Feature: Machine-scoped memory — a computed <scope>#<hash> key, not an authored label

  The bundled template's memory key is COMPUTED (src/PatternMachine.ts's
  `memoryScopeAt`, src/Edge.ts's `memoryKeyFor`) from a `prompt`-content
  state's owning MACHINE INSTANCE, never authored per state: a machine's own
  scope is its dotted instance path in the tree (`""` for the root, `"build"`,
  `"build.health"`, `"packages.item"`, `"packages.item.health"`,
  `"packages.item.spec"`, ...), and the key is `<scope>#<hash7>` — the first 7
  hex characters of the commit the CURRENT unbroken entry into that scope
  started FROM. Entering a DESCENDANT scope (a true dotted-prefix match)
  doesn't break the ancestor's run; entering a sibling or unrelated scope
  does. These scenarios pin the product plan's full "done when" list for this
  feature end to end, via `gtd next --json`'s `.memory` field, against the
  REAL bundled machine tree (`src/workflows/unified.yaml`) — not a synthetic
  `.gtdrc`, since the whole point is the SHAPE of the actual shipped machines.

  Scenario: memory is retained across a machine's own laps — design.triage resumes across a design.gate.answer turn in between
    Given a test project
    And the workflow
    And a commit "gtd(check): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And I record the json field "memory" as "first lap"

    Given a commit "gtd(agent): design.gate.answer" that adds "src/marker-1.txt" with:
      """
      the agent's design.triage turn, routing to design.gate.answer
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.gate.answer\""
    And stdout does not contain "\"memory\""

    Given a commit "gtd(human): design.triage" that adds "src/marker-2.txt" with:
      """
      the human's design.gate.answer turn, sending it back for another lap
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And the json field "memory" matches the one recorded as "first lap"

  Scenario: memory is retained across an excursion into a child machine's own check (and its escalate) — build.fix resumes across build.health.check/.escalate
    Given a test project
    And the workflow
    And a commit "gtd(check): build.fix" that adds ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "first fix attempt"

    Given a commit "gtd(agent): build.health.check" that adds "src/widget.ts" with:
      """
      export const widget = () => undefined
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.check\""
    And stdout does not contain "\"memory\""

    Given a commit "gtd(check): build.health.escalate" that adds ".gtd/FEEDBACK.md" with:
      """
      test failed again: widget() still returns undefined
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.escalate\""
    And stdout does not contain "\"memory\""

    Given a commit "gtd(human): build.fix" that adds "NOTE.md" with:
      """
      the human retried the check after escalation
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And the json field "memory" matches the one recorded as "first fix attempt"

  Scenario: memory is retained across a CHILD's own full agent turn, and that child's own session is never confused with the caller's — packages.item.building ⇄ packages.item.spec.review ⇄ packages.item.fix-spec
    # The sharpest case, and the one the old "last label" driver design (before
    # package 07's per-scope table) got wrong: a full AGENT turn in a nested
    # child machine (packages.item.spec, ▸ planner) sits between two turns of
    # the caller (packages.item, ▸ coder) — the caller's session must survive
    # it untouched, and the child's own session must never be confused with
    # the caller's either.
    Given a test project
    And the workflow
    And a commit "gtd(check): packages.item.building" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And I record the json field "memory" as "the builder's turn"

    Given a commit "gtd(agent): packages.item.spec.review" that adds "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.spec.review\""
    And the json field "memory" differs from the one recorded as "the builder's turn"
    And I record the json field "memory" as "the reviewer's turn"

    Given a commit "gtd(agent): packages.item.fix-spec" that adds ".gtd/SPEC_FEEDBACK.md" with:
      """
      widget() should return a frozen object.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.fix-spec\""
    And the json field "memory" matches the one recorded as "the builder's turn"
    And the json field "memory" differs from the one recorded as "the reviewer's turn"

  Scenario: a fresh memory key per entry — two different packages each get their own distinct session at packages.item.building
    Given a test project
    And the workflow
    And a commit "gtd(check): packages.item.building" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "memory" as "package 1's builder turn"

    Given a commit "gtd(agent): packages.item.closing" that adds "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    Given a commit "gtd(check): packages.picking" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/02-gadget.md
      """
    Given a commit "gtd(check): packages.item.building" that adds "src/marker.txt" with:
      """
      starting the second package
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And the json field "memory" differs from the one recorded as "package 1's builder turn"

  Scenario: two instances of one healthGate-shaped machine never share a session, even with byte-identical check output
    Given a test project
    And the workflow
    When I run gtd with args "visualize --json"
    Then it succeeds
    # Structural proof first: both are genuinely separate instances of the
    # SAME machine, at different points in the tree.
    And stdout matches "\"name\": \"build\.health\",\s*\"machine\": \"healthGate\""
    And stdout matches "\"name\": \"packages\.item\.health\",\s*\"machine\": \"healthGate\""

    Given a commit "gtd(check): build.fix" that adds ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"build#[0-9a-f]{7}\""

    Given a commit "gtd(check): packages.item.fix-suite" that adds ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"packages\.item#[0-9a-f]{7}\""

  Scenario: a reviewer turn never resumes an implementer session, even though both are prompt-content machine instances active around the same point in the trace
    # packages.item.spec (▸ planner) and packages.item (▸ coder) are adjacent
    # in the trace below — a builder turn immediately followed by a reviewer
    # turn — yet their computed keys never share a scope prefix.
    Given a test project
    And the workflow
    And a commit "gtd(check): packages.item.building" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"packages\.item#[0-9a-f]{7}\""

    Given a commit "gtd(agent): packages.item.spec.review" that adds "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"packages\.item\.spec#[0-9a-f]{7}\""
    And stdout does not contain "\"memory\":\"packages.item#"

  Scenario: the builder's session survives a clean sign-off — build.fix and build.squashing resume the session that built the feature
    # humanReview is nested INSIDE buildTail (`build.review`), not a root
    # sibling — a descendant scope doesn't break the parent's run, so dipping
    # into the review tail's own scope and back out to `build.squashing` on
    # sign-off never breaks build's own unbroken run. The reviewer itself
    # (build.review.reviewing) is a SEPARATE scope, so it gets its own key —
    # see the next scenario. (An ACTIONABLE round is a different story: it
    # leaves this machine entirely via the root's own `re-unwind`, which
    # breaks the builder's run on purpose — see default-workflow.feature's
    # own re-unwind scenarios.)
    Given a test project
    And the workflow
    And a commit "gtd(check): build.fix" that adds ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "the builder's turn"

    Given a commit "gtd(agent): build.health.check" that adds "src/widget.ts" with:
      """
      export const widget = () => 1
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.check\""
    And stdout does not contain "\"memory\""

    Given a commit "gtd(check): build.review.reviewing" that adds "src/marker-1.txt" with:
      """
      the check turn, routing to build.review.reviewing
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And the json field "memory" differs from the one recorded as "the builder's turn"

    # `await-review` declares `reviewWindow: true` — querying `gtd next` while
    # resting there would OPEN the review checkout window (a mutating side
    # effect on git state, see src/ReviewWindow.ts), so this scenario never
    # queries at that exact rest; it only builds the commit and moves straight
    # on to the next state, which is where the assertions resume.
    Given a commit "gtd(agent): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1 — new export
      """
    Given a commit "gtd(human): build.review.deciding" that adds "src/marker-2.txt" with:
      """
      the human's await-review turn, ticking every box with no comment
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.deciding\""

    Given a commit "gtd(check): build.squashing" that adds ".gtd/COMMIT_MSG.md" with:
      """
      feat: add widget
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.squashing\""
    And the json field "memory" matches the one recorded as "the builder's turn"

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
    And a commit "gtd(check): build.fix" that adds ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    Given a commit "gtd(agent): build.health.check" that adds "src/widget.ts" with:
      """
      export const widget = () => 1
      """
    Given a commit "gtd(check): build.review.reviewing" that adds "src/marker-1.txt" with:
      """
      the check turn, routing to build.review.reviewing
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And I record the json field "memory" as "round 1's reviewer turn"

    Given a commit "gtd(agent): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1 — new export
      """
    Given a commit "gtd(human): build.review.deciding" that adds ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.
      """
    Given a commit "gtd(agent): build.review.collecting" that adds ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      Judged actionable — a later phase re-derives the work from this commit.
      """
    Given a commit "gtd(check): re-unwind" that adds "src/marker-revert.txt" with:
      """
      the re-unwind turn, reverting the human's edit
      """
    Given a commit "gtd(agent): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Doc comment

      Add a doc comment above the widget export.
      """
    Given a commit "gtd(check): architecture.author" that adds ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: add a doc comment to src/widget.ts.
      """
    Given a commit "gtd(agent): packages.item.building" that adds "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => 1
      """
    Given a commit "gtd(check): build.review.reviewing" that adds "src/marker-3.txt" with:
      """
      the second check turn, routing to build.review.reviewing again
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And the json field "memory" differs from the one recorded as "round 1's reviewer turn"

  Scenario: an actionable loop-back round breaks build's OWN run too — the post-loop-back squash turn never resumes the pre-loop-back builder
    # `build.fix`/`build.squashing` share scope "build" — a plain descendant
    # dip into "build.review" never breaks it (see "the builder's session
    # survives a clean sign-off"), but the re-unwind/design/architecture/
    # packages rows an ACTIONABLE round takes are none of them descendants of
    # "build" either. So the SAME break that gives the reviewer a fresh mind
    # each round (previous scenario) also breaks the builder's own run: by the
    # time the loop-back's own package lands and the round is signed off,
    # build.squashing resumes a scope anchored at THIS pass's own
    # build.review.reviewing turn, never the original build.fix turn from
    # before the round-trip.
    Given a test project
    And the workflow
    And a commit "gtd(check): build.fix" that adds ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "the pre-loop-back builder's turn"

    Given a commit "gtd(agent): build.health.check" that adds "src/widget.ts" with:
      """
      export const widget = () => undefined
      """
    Given a commit "gtd(check): build.review.reviewing" that adds "src/marker-1.txt" with:
      """
      the check turn, routing to build.review.reviewing
      """
    Given a commit "gtd(agent): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1 — new export
      """
    Given a commit "gtd(human): build.review.deciding" that adds ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.
      """
    Given a commit "gtd(agent): build.review.collecting" that adds ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      Judged actionable — a later phase re-derives the work from this commit.
      """
    Given a commit "gtd(check): re-unwind" that adds "src/marker-revert.txt" with:
      """
      the re-unwind turn, reverting the human's edit
      """
    Given a commit "gtd(agent): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Doc comment

      Add a doc comment above the widget export.
      """
    Given a commit "gtd(check): architecture.author" that adds ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: add a doc comment to src/widget.ts.
      """
    Given a commit "gtd(agent): packages.item.building" that adds "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => 1
      """
    Given a commit "gtd(check): build.review.reviewing" that adds "src/marker-3.txt" with:
      """
      the second check turn, routing to build.review.reviewing again
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And the json field "memory" differs from the one recorded as "the pre-loop-back builder's turn"

    Given a commit "gtd(agent): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1 — new export
      """
    Given a commit "gtd(human): build.review.deciding" that adds "src/marker-2.txt" with:
      """
      the human's await-review turn, ticking every box with no comment
      """
    # deciding's clean sign-off short-circuits straight to build.squashing —
    # simulated the same way the sibling scenarios above simulate it.
    Given a commit "gtd(check): build.squashing" that adds ".gtd/COMMIT_MSG.md" with:
      """
      feat: add a doc comment to widget.ts
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.squashing\""
    And the json field "memory" differs from the one recorded as "the pre-loop-back builder's turn"

  Scenario: gtd --entry fix-precheck is the one path where build.fix and build.squashing DO share a key — the concrete benefit that justifies keeping the review tail nested
    # The nesting's whole remaining point: on this entry, build.fix opens
    # build's own scope directly (no packages/design/architecture lap ever
    # runs), and every state from there to build.squashing —
    # build.fix -> build.health.check -> build.review.* -> build.squashing —
    # stays inside that one subtree, so the squash message is drafted by the
    # SAME session that made the fixes.
    Given a test project
    And the workflow
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
    And a file "src/repair.ts" with:
      """
      export const repaired = true
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix → build.health.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"

    Given a commit "gtd(agent): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Repair

      - [ ] ./src/repair.ts#1 — new export
      """
    Given a commit "gtd(human): build.review.deciding" that adds "src/marker.txt" with:
      """
      the human's await-review turn, ticking every box with no comment
      """
    Given a commit "gtd(check): build.squashing" that adds ".gtd/COMMIT_MSG.md" with:
      """
      fix: repair the failing test
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.squashing\""
    And the json field "memory" matches the one recorded as "the fix-precheck path's fix turn"

  Scenario: architecture is a separate memory scope from design, but its own Q&A and decomposition share one session
    # design (designPlan) and architecture (archPlan) are sibling machines with
    # their own memory scope each — a deliberate handover, not one fused
    # conversation, since the technical phase reads the requirements file cold
    # rather than resuming design's own session. Within architecture's own
    # scope, though, the human's answer rationale survives from the Q&A turn
    # into decomposition, exactly as design's own laps resume each other.
    Given a test project
    And the workflow
    And a commit "gtd(check): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      Build a widget.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And I record the json field "memory" as "the design conversation's turn"

    Given a commit "gtd(check): architecture.author" that adds ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the widget.
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"architecture.author\""
    And the json field "memory" differs from the one recorded as "the design conversation's turn"
    And I record the json field "memory" as "the architecture conversation's first turn"

    Given a commit "gtd(agent): architecture.gate.answer" that adds "src/marker-1.txt" with:
      """
      the agent's architecture.author turn, routing to architecture.gate.answer
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"architecture.gate.answer\""
    And stdout does not contain "\"memory\""

    Given a commit "gtd(human): architecture.decompose" that adds "src/marker-2.txt" with:
      """
      the human accepted the technical plan with no open questions left
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"architecture.decompose\""
    And the json field "memory" matches the one recorded as "the architecture conversation's first turn"

  Scenario: the per-package build queue gets a fresh builder session at the shared tail, distinct from any package's own session
    # The per-package build queue (packages.*) closes out into the shared tail
    # (build.review.* -> build.squashing) — that tail opens a fresh
    # `build#...` session there, never resuming any package's own
    # `packages.item#...` session.
    Given a test project
    And the workflow
    And a commit "gtd(check): packages.picking" that adds ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-widget.md
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.picking\""

    Given a commit "gtd(check): packages.item.building" that adds "src/marker.txt" with:
      """
      starting the package
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"packages.item.building\""
    And stdout matches "\"memory\":\"packages\.item#[0-9a-f]{7}\""
    And I record the json field "memory" as "the package builder's turn"

    Given a commit "gtd(check): build.review.reviewing" that adds "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And the json field "memory" differs from the one recorded as "the package builder's turn"

    Given a commit "gtd(agent): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1 — new export
      """
    Given a commit "gtd(human): build.review.deciding" that adds "src/marker-2.txt" with:
      """
      the human's await-review turn, ticking every box with no comment
      """
    Given a commit "gtd(check): build.squashing" that adds ".gtd/COMMIT_MSG.md" with:
      """
      feat: add widget
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.squashing\""
    And the json field "memory" differs from the one recorded as "the package builder's turn"

  Scenario: a state-level "model:" is rejected at load time — model is a machine-level property, not a state one
    # Part of this feature's own "done when" list: a workflow author can no
    # longer put `model:` directly on a state (see validate.feature for the
    # same finding pinned via `gtd validate` specifically) — it belongs on the
    # machine that owns the state (`machines.<name>.model`).
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": working
              working:
                actor: agent
                model: smart
                prompt: "go"
                on:
                  "* **": idle
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "unknown key"
    And stderr contains "model"
    And stderr contains "machine"

  Scenario: a state-level "memory:" is rejected at load time — the scope is computed, so there is no authored label to honour or ignore
    # The counterpart of the `model:` case above: `memory:` is gone OUTRIGHT,
    # with no replacement key, so a config that still declares one is a load
    # error pointing at the new rule — never a silently ignored key that reads
    # as if the authored scope were still in effect.
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": working
              working:
                actor: agent
                memory: plan
                prompt: "go"
                on:
                  "* **": idle
      """
    When I run gtd status
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "unknown key"
    And stderr contains "memory"
    And stderr contains "no longer exists"
