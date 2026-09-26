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
  instead of straight on to `build.review.reviewing`.

  Every scenario reaches `build.health.check` through a real
  `--entry fix-precheck` history (a red precheck, then one fix turn) and
  fabricates each later turn's own resulting diff by hand — same convention
  as `default-workflow.feature` and `spec-review-judgments.feature` — since
  no real driver runs a script or an agent in this harness; only gtd's own
  routing is under test. The
  `seeding`/`picking` scripts themselves are rendered and executed for real by
  `src/workflows/qualityLapScripts.test.ts`.

  @inmem
  Scenario: two dimensions queue and drain in padded order, then the clean lap hands straight on to the human review
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
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
    And the last commit subject is "gtd(check): build.quality.picking → build.review.reviewing"
    And ".gtd/QUALITY_READY.md" does not exist

  @inmem
  Scenario: a findings lap routes through fix-quality and back to the health check
    Given a test project
    And the workflow
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
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
  Scenario: the quality lap runs to completion, unconditionally, ahead of the human review tail
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
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
    # Only now — with the lap fully drained — does the process reach the
    # human review tail at all; there is no fast-path pre-judge left ahead
    # of it to pay for separately.
    And the last commit subject is "gtd(check): build.quality.picking → build.review.reviewing"

  @inmem
  Scenario: a blank qualityReviews disables the lap — seeding writes nothing and hands straight on
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test failed
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality.seeding"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.review.reviewing"
    And ".gtd/QUALITY_DONE.md" does not exist

  @inmem
  Scenario: a second entry sweeps the previous episode's QUALITY_DONE.md, so the lap runs again instead of short-circuiting
    Given a test project
    And the workflow
    # What a completed earlier episode leaves committed: `picking` writes this
    # marker when it drains the queue, and only `packageLoop.picking` ever
    # swept it — a state no `--entry fix-precheck` run visits.
    And a commit "chore: a previous episode's drained quality lap" that adds ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"

    # The entry check's own sweep, plus a red suite. The marker's deletion is
    # part of this same commit's diff; the FEEDBACK.md row is declared first,
    # so a red run still routes to the fix loop.
    Given the file ".gtd/QUALITY_DONE.md" is deleted
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): fix-precheck → build.fix"

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

    # The marker is gone, so seeding actually seeds this time rather than
    # short-circuiting straight through to the review tail.
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
