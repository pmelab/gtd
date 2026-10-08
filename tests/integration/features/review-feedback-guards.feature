@inmem
Feature: Review feedback — capture, classification, and the loop-back guards

  The review feedback lap of the bundled unified workflow.
  Once a human lands `await-review`, `build.review.closing` removes the spent
  `.gtd/REVIEW.md` and the flow decides from that review commit alone. A
  hand-edit outside `.gtd/` is a fact, so it routes straight to `collecting`
  (never interpreted first). A note-only round (`.gtd/REVIEW.md` itself
  changed, nothing hand-edited outside `.gtd/`) is a JUDGMENT call instead,
  so it routes to `build.review.triage` first — one noul per `## ` chunk,
  "actionable, not approval or nit?" — and on to `collecting` only when
  something actually is. The `build.review.collecting` agent then JUDGES
  whether the round is actionable — it never builds; when it IS actionable
  it CLASSIFIES the round straight into `.gtd/REQUIREMENTS.md` as ordered,
  PRODUCT/TECHNICAL concerns (never an instruction list for a builder), and
  the round is re-planned from scratch via the root's own `re-unwind` state,
  which hands the assembled `.gtd/REQUIREMENTS.md` off to `design.triage` to
  fold in (see default-workflow.feature).

  Changing nothing at `collecting` IS a legal outcome — the non-actionable
  sign-off. What `collecting` refuses is a dirty tree that touches
  something OTHER than `.gtd/REQUIREMENTS.md` without writing it — that is
  "you classify, you do not build" enforced structurally, not by
  content-sniffing.

  `design.triage` checks `requireProgress()` on that same
  `.gtd/REQUIREMENTS.md` file: an agent that deletes the assembled review
  input on a loop-back lap without folding it in is exactly the "captured
  then discarded" bug the classify step above already guards against, one
  phase earlier — the feedback-progress check refuses that turn unless the
  deleted content is the `NOTHING ACTIONABLE` sentinel. No bundled state
  writes that sentinel any more, so its exemption is pinned here against a
  minimal custom workflow instead.

  Each check step (`build.review.closing`, `re-unwind`) is simulated by
  making its file changes and running `gtd land`; @inmem never executes the
  scripts.

  Scenario: a note-like unchecked line outside a file pointer no longer blocks sign-off
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    # The committed REVIEW.md already carries a non-`./`-prefixed "- [ ]" note,
    # untouched by the human's edit below. Only the real file pointer is
    # ticked, with no other comment — it signs off cleanly, because the
    # review-doc guard no longer reads tick state at all.
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      Follow-up ideas, not part of this review:
      - [ ] consider renaming the module later

      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
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
    And the last commit subject is "gtd(human): build.review.await-review → build.review.closing"

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → idle"

  Scenario: a note flows through capture, and collecting classifies it into REQUIREMENTS.md — re-unwind re-plans it, never builds on it
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
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
    And the last commit subject is "gtd(human): build.review.await-review → build.review.triage"

    # Only `.gtd/REVIEW.md` changed this round (no hand-edit outside
    # `.gtd/`) — `triage` judges each note with a four-way verdict.
    When I run gtd judge answer with stdin:
      """
      [{"id": "note-1", "answer": "edit", "p": 0.95}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.closing"

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.closing → build.review.collecting"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Rename `add` to `sum`

      PRODUCT — the review left a note on ./src/calc.ts#1 asking to rename
      the `add` export to `sum`.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.review.collecting → re-unwind"

  Scenario: build.review.collecting refuses touching anything other than the requirements file
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    # await-review: a hand-edit outside `.gtd/` is feedback — closing hands
    # it straight to collecting.
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    # No write (A/M) on REQUIREMENTS.md, while some OTHER file is touched
    # instead. No declared pattern recognizes this shape: not a
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
    # Rests at design.triage on a REVIEW LOOP-BACK lap: an actionable round's
    # `build.review.collecting` classified the feedback straight into
    # REQUIREMENTS.md, and re-unwind reverted the hand-edit and handed off here.
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And gtd starts workflow "review" with "--var reviewBase=base"
    And gtd lands "gtd(check): review-gate.check → build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And gtd lands "gtd(agent): build.review.reviewing → build.review.await-review"
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.closing"
    And the file ".gtd/REVIEW.md" is deleted
    And gtd lands "gtd(check): build.review.closing → build.review.collecting"
    And a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Rename `add` to `sum`

      PRODUCT — the review left a note on ./src/calc.ts#1 asking to rename
      the `add` export to `sum`.
      """
    And gtd lands "gtd(agent): build.review.collecting → re-unwind"
    And the file "src/greet.ts" is deleted
    And gtd lands "gtd(check): re-unwind → design.triage"
    Given the file ".gtd/REQUIREMENTS.md" is deleted
    When I run gtd land
    Then it fails
    And stderr contains "without addressing its instructions"

  Scenario: a NOTHING ACTIONABLE sentinel is the one exemption, pinned against a minimal custom workflow since no bundled state writes it any more
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, requireProgress } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write .gtd/FEEDBACK.md, then run `gtd land`" })
        await agent("drafting", "address .gtd/FEEDBACK.md, then delete it", {
          file: ".gtd/FEEDBACK.md",
        })
        requireProgress(".gtd/FEEDBACK.md")
        await human("done", { message: "feedback addressed" })
      }
      """
    And a file ".gtd/FEEDBACK.md" with:
      """
      NOTHING ACTIONABLE — the human left only an approving remark.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → drafting"

    # drafting: the only pending change deletes .gtd/FEEDBACK.md, but its
    # deleted content IS the sentinel — the one content that exempts the
    # file from requireProgress().
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): drafting → done"
