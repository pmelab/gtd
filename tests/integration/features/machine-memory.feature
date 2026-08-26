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
    # build.health and packages.item.health are both healthGate instances at
    # different points in the tree (src/workflows/unified.yaml) — the proof
    # below is that their computed memory keys never collide, even though
    # both land byte-identical FEEDBACK.md check output.

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
    And I record the json field "memory" as "the reviewer's turn"

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

      - [ ] ./src/widget.ts#1
      new export
      """
    Given a commit "gtd(human): build.review.deciding" that adds ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.
      """
    Given a commit "gtd(check): build.review.collecting" that adds ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.

      Commit: deadbeef
      """
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

      - [ ] ./src/widget.ts#1
      new export
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

      - [ ] ./src/widget.ts#1
      new export
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

  Scenario: gtd --entry fix-precheck's own build.fix session survives into the shared review tail — reviewing and collecting share the session even on the collapsed entry
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
    # for the collapsed fix-precheck entry, since that's the one route where
    # build.fix opens the scope directly rather than resuming it.
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
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"

    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.reviewing\""
    And I record the json field "memory" as "the fix-precheck path's reviewer turn"

    Given a commit "gtd(agent): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Repair

      - [ ] ./src/repair.ts#1
      new export
      """
    Given a commit "gtd(human): build.review.deciding" that adds ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.
      """
    Given a commit "gtd(check): build.review.collecting" that adds ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent
      judges whether it's actionable.

      Commit: deadbeef
      """
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

  Scenario: the per-package build queue gets a fresh reviewer session at the shared tail, distinct from any package's own session
    # The per-package build queue (packages.*) closes out into the shared tail
    # (build.review.*) — that tail opens a fresh `build.review#...` session
    # there, never resuming any package's own `packages.item#...` session.
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
    When I run gtd next
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
    When I run gtd next
    Then it fails
    And stderr contains "workflow config:"
    And stderr contains "unknown key"
    And stderr contains "memory"
    And stderr contains "no longer exists"
