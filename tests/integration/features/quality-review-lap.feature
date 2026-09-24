Feature: the qualitative review lap (.gtd/packages/01-quality-review-lap.md)

  `build.quality` sits between the green health check and the human review
  tail. `seeding` writes one `.gtd/reviews/NN-<name>.md` file per
  comma-separated `qualityReviews` entry; `picking` moves the head entry into
  `.gtd/NEXT_REVIEW.md` and deletes it from the queue — the `ls | head -n 1`
  idiom `packageLoop.picking` already uses; `reviewing` loads that file as
  its own `skills:` and APPENDS any blocking finding to `.gtd/QUALITY.md`.
  Draining the queue writes `.gtd/QUALITY_DONE.md` unconditionally (so a
  re-entry into `build.quality` this same episode short-circuits straight
  through) and `.gtd/QUALITY_READY.md` only when `.gtd/QUALITY.md` is
  non-empty, which is what routes a findings round to `build.fix-quality`
  instead of straight on to `build.review.pre`.

  Every scenario here fabricates each turn's own resulting diff by hand —
  same convention as `default-workflow.feature` and
  `spec-review-judgments.feature` — since no real driver runs a script or an
  agent in this harness; only gtd's own routing is under test.

  @inmem
  Scenario: two dimensions queue and drain in padded order, then the clean lap hands straight on to the human review
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.fix" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And a commit "gtd(agent): build.health.check" that adds ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    Given the file ".gtd/FEEDBACK.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.seeding"

    # seeding writes one padded, zero-indexed file per bundled dimension.
    Given a file ".gtd/reviews/01-owasp-security.md" with:
      """
      owasp-security
      """
    And a file ".gtd/reviews/02-code-simplification.md" with:
      """
      code-simplification
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.quality.picking"

    # picking moves the head entry (01, lexically first) into NEXT_REVIEW.md.
    Given a file ".gtd/NEXT_REVIEW.md" with:
      """
      owasp-security
      """
    And the file ".gtd/reviews/01-owasp-security.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.quality.reviewing"
    And ".gtd/reviews/02-code-simplification.md" exists

    # A clean reviewing turn under the owasp-security lens — nothing blocking.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.quality.picking"

    # picking drains the second (02) entry next, never the first again.
    Given a file ".gtd/NEXT_REVIEW.md" with:
      """
      code-simplification
      """
    And the file ".gtd/reviews/02-code-simplification.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.quality.reviewing"

    # A clean reviewing turn under the code-simplification lens too.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.quality.picking"

    # The queue is empty and .gtd/QUALITY.md was never written — a clean
    # lap hands straight on to the human review tail, never fix-quality.
    Given the file ".gtd/NEXT_REVIEW.md" is deleted
    And a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.review.pre"
    And ".gtd/QUALITY_READY.md" does not exist

  @inmem
  Scenario: a findings lap routes through fix-quality and back to the health check
    Given a test project
    And the workflow
    And a commit "gtd(agent): build.health.check" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.seeding"

    Given a file ".gtd/reviews/01-owasp-security.md" with:
      """
      owasp-security
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.quality.picking"

    Given a file ".gtd/NEXT_REVIEW.md" with:
      """
      owasp-security
      """
    And the file ".gtd/reviews/01-owasp-security.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.quality.reviewing"

    # The reviewer found something blocking under this one lens and appends
    # a `## ` chunk, never overwriting the file.
    Given a file ".gtd/QUALITY.md" with:
      """
      ## Hardcoded secret in src/thing.ts

      `thing` embeds what looks like a credential inline — move it to an
      environment variable instead.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.quality.picking"

    # The queue drains with a non-empty .gtd/QUALITY.md on disk — picking
    # writes BOTH markers; first-match-wins routes this to fix-quality, not
    # the clean exit.
    Given the file ".gtd/NEXT_REVIEW.md" is deleted
    And a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    And a file ".gtd/QUALITY_READY.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.fix-quality"

    # fix-quality resolves the finding, deletes .gtd/QUALITY.md (and its own
    # ready marker), and hands back to the health check — never straight to
    # the human review.
    Given the file ".gtd/QUALITY.md" is deleted
    And the file ".gtd/QUALITY_READY.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix-quality → build.health.check"

  @inmem
  Scenario: a round the fast-path judge calls mechanical still runs the whole quality lap before reaching fastReview
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"
    And a commit "gtd(agent): build.health.check" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.seeding"

    Given a file ".gtd/reviews/01-owasp-security.md" with:
      """
      owasp-security
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.quality.picking"

    Given a file ".gtd/NEXT_REVIEW.md" with:
      """
      owasp-security
      """
    And the file ".gtd/reviews/01-owasp-security.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.quality.reviewing"

    # A clean reviewing turn — nothing blocking under this one dimension.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.quality.picking"

    Given the file ".gtd/NEXT_REVIEW.md" is deleted
    And a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.picking → build.review.pre"

    # Only now — with the lap fully drained — does the fast-path pre-judge
    # get a turn at all. A confident mechanical/no-public-API/no-behavior
    # verdict still reaches fastReview, but only after paying for the lap.
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

    Given a file ".gtd/REVIEW_FAST.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.preCheck → build.review.fastReview"

  @inmem
  Scenario: a blank qualityReviews disables the lap — seeding writes nothing and hands straight on
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a commit "gtd(agent): build.health.check" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.seeding"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.review.pre"
    And ".gtd/QUALITY_DONE.md" does not exist
