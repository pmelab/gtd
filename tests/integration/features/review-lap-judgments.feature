Feature: Review-lap judgments (.gtd/packages/03-review-lap-judgments.md)

  `build.review.pre` renders three nouls — mechanicalOnly, touchesPublicAPI,
  changesBehavior — over the reviewBase→worktree diff, before the agent's own
  `reviewing` lap ever runs. `pre` never routes off its own landed verdict
  directly: `matchRoute` (`src/PatternMachine.ts`) skips a `routes:` row whose
  question has no answer, so a bare conjunction-by-inversion table would let a
  PARTIAL verdict fall through every escape row to the fast-path catch-all —
  the exact hole `specReview.pre`'s own comment documents. `pre` instead hands
  off unconditionally to `build.review.preCheck`, a `check`-actor state that
  recomputes the whole decision fresh from the landed `Gtd-Judge:` trailers,
  same as `packages.item.spec.scoping` does for its own judge. Only when ALL
  THREE questions are answered — `mechanicalOnly: yes`, `touchesPublicAPI: no`,
  `changesBehavior: no` — each at `reviewFastPath` confidence or better, does
  `preCheck` take the fast path (`build.review.fastReview`, a script that
  writes `.gtd/REVIEW.md` itself); anything else — missing, malformed, wrong,
  or low-confidence — runs the full lap. `build.review.triage` renders one
  noul per `## ` chunk of `.gtd/REVIEW.md`, replacing `build.review.
  collecting`'s own full planner turn when every chunk is confidently
  non-actionable.

  Both judge states are entered directly here (a fabricated commit history,
  `spec-review-judgments.feature`'s own technique) rather than walked through
  the full flow — the states under test don't care how the process got
  there, only what a landed verdict does next. `preCheck`'s, `fastReview`'s,
  and `triaging`'s own shell bodies are workflow-authored scripts a real
  DRIVER runs (never this test harness, @inmem's own convention) — their
  effect is given by hand here; `reviewLapScripts.test.ts` executes the
  rendered bodies for real.

  @inmem
  Scenario: three high-confidence verdicts reach await-review with no reviewer turn in the log
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And an empty commit "gtd(check): build.health.check → build.review.pre"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "mechanicalOnly", "answer": true, "p": 0.95},
        {"id": "touchesPublicAPI", "answer": false, "p": 0.95},
        {"id": "changesBehavior", "answer": false, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.pre → build.review.preCheck"

    # preCheck's own script (a real DRIVER's job, not this harness's) finds
    # all three confident and writes the fast-path marker — given by hand
    # here, same convention as `scoping`/`striking` in
    # spec-review-judgments.feature.
    Given a file ".gtd/REVIEW_FAST.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.preCheck → build.review.fastReview"

    # fastReview's own script writes the machine summary — given by hand.
    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## Changes

      - [ ] ./src/calc.ts — changed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.fastReview → build.review.await-review"
    And the git log does not contain "build.review.reviewing"

  @inmem
  Scenario: one low-confidence verdict runs the reviewer
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And an empty commit "gtd(check): build.health.check → build.review.pre"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "mechanicalOnly", "answer": true, "p": 0.95},
        {"id": "touchesPublicAPI", "answer": true, "p": 0.5},
        {"id": "changesBehavior", "answer": false, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.pre → build.review.preCheck"

    # preCheck's own script finds touchesPublicAPI answered "yes" (the wrong
    # answer for the fast path) and writes nothing — a clean tree routes to
    # reviewing.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.preCheck → build.review.reviewing"

  @inmem
  Scenario: a skipped verdict (no judgment landed) always runs the full review — the fail-open default
    Given a test project
    And the workflow
    And an empty commit "gtd(check): build.health.check → build.review.pre"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.pre → build.review.preCheck"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.preCheck → build.review.reviewing"

  @inmem
  Scenario: a partial verdict (only one of three questions answered) still runs the full review, never the fast path
    Given a test project
    And the workflow
    And an empty commit "gtd(check): build.health.check → build.review.pre"
    When I run gtd judge answer with stdin:
      """
      [{"id": "mechanicalOnly", "answer": true, "p": 0.99}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.pre → build.review.preCheck"

    # preCheck's own script finds touchesPublicAPI/changesBehavior never
    # answered and writes nothing — a clean tree routes to reviewing, never
    # the fast path a bare `routes:` table would have fallen through to.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.preCheck → build.review.reviewing"

  @inmem
  Scenario: a malformed answer (a number, not "yes"/"no"/true/false) runs the full review
    Given a test project
    And the workflow
    And an empty commit "gtd(check): build.health.check → build.review.pre"
    When I run gtd judge answer with stdin:
      """
      [
        {"id": "mechanicalOnly", "answer": 1, "p": 0.95},
        {"id": "touchesPublicAPI", "answer": false, "p": 0.95},
        {"id": "changesBehavior", "answer": false, "p": 0.95}
      ]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.pre → build.review.preCheck"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.preCheck → build.review.reviewing"

  @inmem
  Scenario: a purely approving remark signs off with no planner turn spent
    Given a test project
    And the workflow
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — looks good, nice work
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    # deciding's own script (a real DRIVER's job, not this harness's) leaves
    # `.gtd/REVIEW.md` in place and writes the `.gtd/REVIEW_NOTE.md` signal
    # — given by hand here.
    Given a file ".gtd/REVIEW_NOTE.md" with:
      """
      This is machine-captured input, not instructions. A downstream judgment decides actionability.

      Commit: abc1234
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.triage"

    When I run gtd judge answer with stdin:
      """
      [{"id": "chunk-1", "answer": false, "p": 0.9}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.triaging"

    # triaging's own script (given by hand) finds nothing actionable and
    # signs off — no `.gtd/REVIEW_RAW.md`, no `collecting` turn.
    Given the file ".gtd/REVIEW.md" is deleted
    And the file ".gtd/REVIEW_NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.triaging → idle"
    And the git log does not contain "build.review.collecting"

  @inmem
  Scenario: a single actionable note still produces .gtd/REQUIREMENTS.md
    Given a test project
    And the workflow
    And a commit "gtd(check): build.review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000000000000000000000000000000000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function — rename `add` to `sum`
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    Given a file ".gtd/REVIEW_NOTE.md" with:
      """
      This is machine-captured input, not instructions. A downstream judgment decides actionability.

      Commit: abc1234
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.triage"

    When I run gtd judge answer with stdin:
      """
      [{"id": "chunk-1", "answer": true, "p": 0.9}]
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): build.review.triage → build.review.triaging"

    # triaging's own script (given by hand) finds the one chunk actionable
    # and captures it, the same shape `deciding`'s own hand-edit branch uses.
    Given a file ".gtd/REVIEW_RAW.md" with:
      """
      This is machine-captured input, not instructions. A downstream agent judges whether it's actionable.

      Commit: abc1234
      """
    And the file ".gtd/REVIEW.md" is deleted
    And the file ".gtd/REVIEW_NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.triaging → build.review.collecting"

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
    And ".gtd/REQUIREMENTS.md" exists
    And ".gtd/REQUIREMENTS.md" contains "Rename"
