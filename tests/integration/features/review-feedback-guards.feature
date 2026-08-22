@inmem
Feature: Review feedback — capture, classification, and the loop-back guards

  The review feedback lap of the bundled unified workflow (see STATES.md §10).
  A human comment at `await-review` routes to `build.review.deciding`, which CAPTURES
  the raw material into `.gtd/REVIEW_RAW.md` (never interprets it). The
  `build.review.collecting` agent then JUDGES whether the round is
  actionable — it never builds; when it IS actionable it CLASSIFIES the
  round straight into `.gtd/REQUIREMENTS.md` as ordered, PRODUCT/TECHNICAL
  concerns (never an instruction list for a builder), and the round is
  re-planned from scratch via the root's own `re-unwind` state, which hands
  the assembled `.gtd/REQUIREMENTS.md` off to `design.triage` to fold in (see
  default-workflow.feature).

  Consuming the raw capture with nothing else, and writing no
  `.gtd/REQUIREMENTS.md`, IS a legal outcome now — the non-actionable
  sign-off short-circuit (`"D .gtd/REVIEW_RAW.md": $onSignoff`), the same trick
  `deciding` already uses one state earlier. What `collecting` still refuses
  is a dirty tree that touches something OTHER than `.gtd/REQUIREMENTS.md` /
  `.gtd/REVIEW_RAW.md` while leaving neither of the declared rows matched: no
  `A`/`M` on `.gtd/REQUIREMENTS.md` and no `D` on `.gtd/REVIEW_RAW.md`, and no
  `"* **"` catch-all declared to excuse it — that is "you classify, you do
  not build" enforced structurally, not by content-sniffing.

  `design.triage` declares `requireProgress: true` on that same
  `.gtd/REQUIREMENTS.md` file: an agent that deletes the assembled review
  input on a loop-back lap without folding it in is exactly the "captured
  then discarded" bug the capture/classify split above already guards
  against, one phase earlier — the feedback-progress guard
  (`src/StepGuards.ts`) refuses that turn unless the deleted content is the
  `NOTHING ACTIONABLE` sentinel. No bundled state writes that sentinel any
  more, so its exemption is pinned here against a minimal custom workflow
  instead.

  Each check-actor turn (`build.review.deciding`) is simulated by writing its verdict
  files and running `gtd land`; @inmem never executes the scripts.

  Scenario: a note-like unchecked line outside a file pointer no longer blocks sign-off
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    # The committed REVIEW.md already carries a non-`./`-prefixed "- [ ]" note,
    # untouched by the human's edit below. Only the real file pointer is
    # ticked, with no other comment — it signs off cleanly, because the
    # review-doc guard no longer reads tick state at all.
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Follow-up ideas, not part of this review:
      - [ ] consider renaming the module later

      - [ ] ./src/calc.ts#1
      new add function
      """
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Follow-up ideas, not part of this review:
      - [ ] consider renaming the module later

      - [x] ./src/calc.ts#1
      new add function
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

  Scenario: a note flows through capture, and collecting classifies it into REQUIREMENTS.md — re-unwind re-plans it, never builds on it
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — rename `add` to `sum`
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      ## Notes the human added to REVIEW.md this round

      - [x] ./src/calc.ts#1 — new add function — rename `add` to `sum`
      """
    And the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Rename `add` to `sum`

      PRODUCT — the review left a note on ./src/calc.ts#1 asking to rename
      the `add` export to `sum`.
      """
    And the file ".gtd/REVIEW_RAW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"
    And ".gtd/REVIEW_RAW.md" does not exist

  Scenario: build.review.collecting refuses touching anything other than the raw capture
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd(check): build.review.deciding → build.review.collecting" that adds ".gtd/REVIEW_RAW.md" with:
      """
      Raw review material captured for classification.

      ## Notes the human added to REVIEW.md this round

      - [x] ./src/calc.ts#1 — rename `add` to `sum`
      """
    # Neither a write (A/M) on REQUIREMENTS.md nor a consume (D) on the raw
    # capture — the raw capture is left exactly as committed, while some OTHER
    # file is touched instead. No declared row recognizes this shape: not a
    # classification, just a refusal.
    Given "src/calc.ts" is modified to:
      """
      export const sum = (a: number, b: number) => a + b
      """
    When I run gtd land
    Then it fails
    And stderr contains "no declared pattern matches"

  Scenario: design.triage refuses deleting the assembled requirements file on a loop-back lap without addressing it
    Given a test project
    And the workflow
    # Simulates resting at design.triage on a REVIEW LOOP-BACK lap: an earlier
    # actionable round's `build.review.collecting` already classified the
    # feedback straight into REQUIREMENTS.md, and re-unwind already handed off
    # here.
    And a commit "gtd(check): re-unwind → design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      ## Rename `add` to `sum`

      PRODUCT — the review left a note on ./src/calc.ts#1 asking to rename
      the `add` export to `sum`.
      """
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "without addressing its instructions"

  Scenario: a NOTHING ACTIONABLE sentinel is the one exemption, pinned against a minimal custom workflow since no bundled state writes it any more
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
                message: "write .gtd/FEEDBACK.md, then run `gtd land`"
                on:
                  "* **": drafting
              drafting:
                actor: agent
                file: FEEDBACK.md
                requireProgress: true
                prompt: "address .gtd/FEEDBACK.md, then delete it"
                on:
                  "* **": done
              done:
                commit: "chore: feedback addressed"
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      NOTHING ACTIONABLE — the human left only an approving remark.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → drafting"

    # drafting: the only pending change deletes .gtd/FEEDBACK.md, but its
    # deleted content IS the sentinel — the one content that exempts a
    # requireProgress state's file from the guard.
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "chore: feedback addressed"
