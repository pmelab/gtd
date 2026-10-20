@inmem
Feature: Machine-scoped memory — a computed <scope>#<hash> key, not an authored label

  The bundled workflow's memory key is COMPUTED from a `prompt`-content
  step's memory scope, never authored per step: the scope is the step name's
  `scope()` prefix (`""` for the root, `"build"`, `"build.health"`,
  `"implement"`, ...), and the key is
  `<scope>#<hash7>` — the first 7 hex characters of the commit the CURRENT
  unbroken run into that scope started FROM. Entering a DESCENDANT scope (a
  true dotted-prefix match) doesn't break the ancestor's run; entering a
  sibling or unrelated scope does. These scenarios pin that end to end, via
  `gtd next --json`'s `.memory` field, against the REAL bundled workflow
  (`src/workflows/feature/feature.ts`), each reaching its steps by a real landed
  history — not a synthetic config, since the whole point is the SHAPE of
  the actual shipped scopes.

  Scenario: memory is retained across a machine's own laps — design.triage resumes across a design.gate.answer turn in between
    Given a test project
    And the workflow gtd install scaffolds
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
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

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
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

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(human): design.gate.answer → design.triage"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And the json field "memory" matches the one recorded as "first lap"

  Scenario: memory is retained across an excursion into a child machine's own check/escalate/describe/stop — build.fix resumes across the whole detour
    Given a test project
    And the workflow gtd install scaffolds
    And gtd starts workflow "fix"
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
    And gtd lands "gtd(judge): build.health.judge → build.health.recheck" judging:
      """
      [{"id": "verdict", "answer": "identical", "p": 0.95}]
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed on re-run: widget() still returns undefined
      """
    And gtd lands "gtd(check): build.health.recheck → build.health.describe"

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

  Scenario: a nested child scope never reuses its caller's session — implement.fix.suite.fixing gets its own, not implement.building's
    Given a test project
    And the workflow gtd install scaffolds
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget. No open questions.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → seam.naive"
    And a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    # A naive pass that only adds files is exempt from the judge: it lands.
    And a file "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And gtd lands "gtd(agent): seam.naive → seam.check"
    And gtd lands "gtd(check): seam.check → implement.applying"
    # The kept pass no longer applies: implement builds it fresh.
    And a file ".gtd/FEEDBACK.md" with:
      """
      gtd could not apply the naive pass
      """
    And gtd lands "gtd(check): implement.applying → implement.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"implement.building\""
    And I record the json field "memory" as "the builder's turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    And gtd lands "gtd(agent): implement.building → implement.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns an unfrozen object
      """
    And gtd lands "gtd(check): implement.health.check → implement.fix.suite.fixing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"implement.fix.suite.fixing\""
    And the json field "memory" differs from the one recorded as "the builder's turn"
    And stdout matches "\"memory\":\"implement\.fix\.suite#[0-9a-f]{7}\""

  Scenario: two instances of one healthGate-shaped machine never share a session, even with byte-identical check output
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { afterTail, baseline, buildTail, gate } from "@pmelab/gtd/workflows"

      export {
        feature as default,
        feature,
        defaults,
        envDefaults,
        summary,
        base,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows"

      // review and fix as feature's own tail: a note is triaged and re-planned.
      export async function review() {
        await gate("review-gate", "The baseline is red.")
        return afterTail(await buildTail(start()))
      }

      export async function fix() {
        if (await baseline("fix-precheck")) return
        return afterTail(await buildTail(start(), { fixFirst: true }))
      }
      """
    # build.health and implement.health are both healthGate instances at
    # different points in the tree — the proof below is that their computed
    # memory keys never collide, even though both land byte-identical
    # FEEDBACK.md check output.

    Given an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd starts workflow "fix"
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
    And gtd lands "gtd(check): build.health.check → build.review.composing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1
      new export
      """
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — closing
    # (simulated by hand) hands it straight on to collecting.
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    # collecting judges the round actionable; re-unwind reverts the
    # hand-edit, and the whole plan is re-derived from scratch.
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Doc comment

      Add a doc comment above the widget export.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    And the file "src/greet.ts" is deleted
    And gtd lands "gtd(check): re-unwind → design.triage"
    And ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Doc comment

      Add a doc comment above the widget export. No open questions.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → implement.building"
    And a file "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): implement.building → implement.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): implement.health.check → implement.fix.suite.fixing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"implement\.fix\.suite#[0-9a-f]{7}\""

  Scenario: a fresh review session per round — the loop-back gives each review round's collecting turn a new mind
    # build.review.collecting's own scope ("build.review") is a descendant of
    # "build", but getting back to it after an actionable round passes all the
    # way out through the root's own `re-unwind` and a full design/implement
    # lap, none of which are descendants of `build.review` — so each round is
    # read with fresh eyes.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { afterTail, baseline, buildTail, gate } from "@pmelab/gtd/workflows"

      export {
        feature as default,
        feature,
        defaults,
        envDefaults,
        summary,
        base,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows"

      // review and fix as feature's own tail: a note is triaged and re-planned.
      export async function review() {
        await gate("review-gate", "The baseline is red.")
        return afterTail(await buildTail(start()))
      }

      export async function fix() {
        if (await baseline("fix-precheck")) return
        return afterTail(await buildTail(start(), { fixFirst: true }))
      }
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd starts workflow "fix"
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
    And gtd lands "gtd(check): build.health.check → build.review.composing"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1
      new export
      """
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — closing
    # (simulated by hand) hands it straight on to collecting.
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "memory" as "round 1's collecting turn"
    # collecting judges the round actionable; re-unwind reverts the
    # hand-edit, and the whole plan is re-derived from scratch.
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Doc comment

      Add a doc comment above the widget export.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    And the file "src/greet.ts" is deleted
    And gtd lands "gtd(check): re-unwind → design.triage"
    And ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Doc comment

      Add a doc comment above the widget export. No open questions.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → implement.building"
    And a file "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): implement.building → implement.health.check"
    And gtd lands "gtd(check): implement.health.check → implement.coverage"
    And gtd lands "gtd(judge): implement.coverage → implement.closing" judging:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And gtd lands "gtd(check): implement.closing → build.review.composing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      The widget export.
      """
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.collecting\""
    And the json field "memory" differs from the one recorded as "round 1's collecting turn"

  Scenario: an actionable loop-back round breaks build's OWN run too — the post-loop-back collecting turn never resumes the pre-loop-back builder
    # The re-unwind/design/implement rows an ACTIONABLE round takes are not
    # descendants of "build", so they break the builder's own run: the
    # post-loop-back build.review.collecting is anchored at THIS pass's entry
    # into the shared tail, never the build.fix turn from before the round-trip.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { afterTail, baseline, buildTail, gate } from "@pmelab/gtd/workflows"

      export {
        feature as default,
        feature,
        defaults,
        envDefaults,
        summary,
        base,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows"

      // review and fix as feature's own tail: a note is triaged and re-planned.
      export async function review() {
        await gate("review-gate", "The baseline is red.")
        return afterTail(await buildTail(start()))
      }

      export async function fix() {
        if (await baseline("fix-precheck")) return
        return afterTail(await buildTail(start(), { fixFirst: true }))
      }
      """
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd starts workflow "fix"
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
    And gtd lands "gtd(check): build.health.check → build.review.composing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      - [ ] ./src/widget.ts#1
      new export
      """
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — closing
    # (simulated by hand) hands it straight on to collecting.
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    # collecting judges the round actionable; re-unwind reverts the
    # hand-edit, and the whole plan is re-derived from scratch.
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Doc comment

      Add a doc comment above the widget export.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    And the file "src/greet.ts" is deleted
    And gtd lands "gtd(check): re-unwind → design.triage"
    And ".gtd/REQUIREMENTS.md" is modified to:
      """
      ## Doc comment

      Add a doc comment above the widget export. No open questions.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → implement.building"
    And a file "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): implement.building → implement.health.check"
    And gtd lands "gtd(check): implement.health.check → implement.coverage"
    And gtd lands "gtd(judge): implement.coverage → implement.closing" judging:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And gtd lands "gtd(check): implement.closing → build.review.composing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add widget.ts

      The widget export.
      """
    And gtd lands "gtd(check): build.review.composing → build.review.await-review"
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.collecting\""
    And the json field "memory" differs from the one recorded as "the pre-loop-back builder's turn"

  Scenario: gtd --workflow fix's own build.fix session survives a red re-check on the fix-precheck entry
    # On this entry build.fix opens build's own scope directly (no
    # design/seam/implement lap ever runs). A still-red check loops build.fix
    # back into itself without leaving "build", so its second entry's memory
    # must match its first.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { start } from "@pmelab/gtd/flows"
      import { afterTail, baseline, buildTail, gate } from "@pmelab/gtd/workflows"

      export {
        feature as default,
        feature,
        defaults,
        envDefaults,
        summary,
        base,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows"

      // review and fix as feature's own tail: a note is triaged and re-planned.
      export async function review() {
        await gate("review-gate", "The baseline is red.")
        return afterTail(await buildTail(start()))
      }

      export async function fix() {
        if (await baseline("fix-precheck")) return
        return afterTail(await buildTail(start(), { fixFirst: true }))
      }
      """
    # Blanks the queue so a green health check hands straight to the human
    # review tail — the quality lap itself is covered in its own feature.
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    When I run gtd with args "--workflow fix"
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

  Scenario: seam is a separate memory scope from design, and implement is its own scope with its own session
    # design, seam and implement are sibling machines with their own memory
    # scope each — a deliberate handover, not one fused conversation: the
    # naive pass reads the requirements file cold rather than resuming
    # design's own session, and implement starts fresh from the judged pass.
    Given a test project
    And the workflow gtd install scaffolds
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And I record the json field "memory" as "the design conversation's turn"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget. No open questions.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → seam.naive"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"seam.naive\""
    And the json field "memory" differs from the one recorded as "the design conversation's turn"
    And stdout matches "\"memory\":\"seam#[0-9a-f]{7}\""
    And I record the json field "memory" as "the naive pass's turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    # A naive pass that only adds files is exempt from the judge: it lands.
    And a file "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And gtd lands "gtd(agent): seam.naive → seam.check"
    And gtd lands "gtd(check): seam.check → implement.applying"
    # The kept pass no longer applies: implement builds it fresh.
    And a file ".gtd/FEEDBACK.md" with:
      """
      gtd could not apply the naive pass
      """
    And gtd lands "gtd(check): implement.applying → implement.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"implement.building\""
    And the json field "memory" differs from the one recorded as "the design conversation's turn"
    And the json field "memory" differs from the one recorded as "the naive pass's turn"
    And stdout matches "\"memory\":\"implement#[0-9a-f]{7}\""

  Scenario: implement closes into a fresh reviewer session at the shared tail, distinct from the builder's own session
    # implement.* closes out into the shared tail (build.quality.*) — that
    # tail opens a fresh `build.quality.<lens>#...` session there, never resuming
    # implement's own `implement#...` session.
    Given a test project
    And the workflow gtd install scaffolds
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
    And a file "NOTE.md" with:
      """
      a sketch
      """

    And gtd lands "gtd(human): idle → unwind"

    And the file "NOTE.md" is deleted

    And gtd lands "gtd(check): unwind → start-gate.check"
    And gtd lands "gtd(check): start-gate.check → design.triage"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget. No open questions.

      ## Acceptance Criteria

      - AC-1: the change behaves as described.
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    And gtd lands "gtd(human): design.gate.answer → seam.naive"
    And a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    # A naive pass that only adds files is exempt from the judge: it lands.
    And a file "src/acceptance.test.ts" with:
      """
      it("[AC-1] holds", () => {})
      """
    And gtd lands "gtd(agent): seam.naive → seam.check"
    And gtd lands "gtd(check): seam.check → implement.applying"
    # The kept pass no longer applies: implement builds it fresh.
    And a file ".gtd/FEEDBACK.md" with:
      """
      gtd could not apply the naive pass
      """
    And gtd lands "gtd(check): implement.applying → implement.building"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"implement.building\""
    And stdout matches "\"memory\":\"implement#[0-9a-f]{7}\""
    And I record the json field "memory" as "the implement builder's turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => Object.freeze({})
      """
    And gtd lands "gtd(agent): implement.building → implement.health.check"
    And gtd lands "gtd(check): implement.health.check → implement.coverage"
    And gtd lands "gtd(judge): implement.coverage → implement.closing" judging:
      """
      [{"id":"AC-1","answer":"yes","p":0.9}]
      """
    And the file ".gtd/REQUIREMENTS.md" is deleted
    And gtd lands "gtd(check): implement.closing → build.quality.correctness.reviewing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.quality.correctness.reviewing\""
    And the json field "memory" differs from the one recorded as "the implement builder's turn"

  Scenario: two agent steps in one memory scope with different models refuse to land — one scope is one conversation, with one model
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("draft", "draft it", { model: "smart" })
        await agent("refine", "refine it", { model: "fast" })
      }
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
    And stderr contains "runs with a different model, system prompt, skills or file access"
    And stderr contains "one scope is one conversation"

  Scenario: a step-level "memory:" option is rejected at load time — the scope is computed, so there is no authored label to honour or ignore
    # An unknown step option is never silently ignored: it would read as if
    # the authored scope were in effect.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("working", "go", { memory: "plan" })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "unknown key"
    And stderr contains "memory"
