Feature: the qualitative review lap (.gtd/packages/01-quality-review-lap.md, .gtd/packages/04-migrate-bundled-loops.md)

  `build.quality` sits between `build.health`'s green check and the human
  review tail, guarded by `quality-gate` ahead of it and closed out by
  `quality-check` after it. `quality-gate`'s own clean tree (nothing to do
  this episode yet) enters `build.quality`'s `each: { var: qualityReviews }`
  loop — one item per comma-separated `qualityReviews` entry, in order, no
  `seeding`/`picking` queue file any more. `reviewing` loads the current
  item as its own `skills:` (`it.item`) and APPENDS any blocking finding to
  `.gtd/QUALITY.md`; reaching the last item's clean/dirty exit routes
  straight to `quality-check`'s own `drained:` target, in the same decision
  as any other item's advance. `quality-check` writes `.gtd/QUALITY_DONE.md`
  unconditionally (so a re-entry into `build.quality` this same episode
  short-circuits at `quality-gate` instead) and stamps `.gtd/QUALITY.md`
  only when it already carries a finding — which is what routes a findings
  round to `build.fix-quality` instead of straight on to `build.review.reviewing`.

  Every scenario here fabricates each turn's own resulting diff by hand —
  same convention as `default-workflow.feature` and
  `spec-review-judgments.feature` — since no real driver runs a script or an
  agent in this harness; only gtd's own routing is under test. A fresh entry
  into `build.quality`'s own `each:` loop needs no hand-authored
  `.gtd/NEXT_REVIEW.md`/`Gtd-Each:` trailer either — `gtd land` derives and
  records the snapshot itself, exactly like any other `each:` reference (see
  `each-loop.feature`). The `quality-gate`/`quality-check` scripts themselves
  are rendered and executed for real by
  `src/workflows/qualityLapScripts.test.ts`; `packages-sweep`'s own five-
  pattern sweep (the one path that clears a stale `.gtd/QUALITY_DONE.md` on a
  feedback loop-back) is rendered and executed for real by
  `src/workflows/packagesSweepScript.test.ts`.

  @inmem
  Scenario: two dimensions queue and drain through each: in order, then the clean lap hands straight on to the human review
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
    And the last commit subject is "gtd(check): build.health.check → build.quality-gate"

    # quality-gate: the lap hasn't run this episode -> a clean step enters
    # the loop, `each: { var: qualityReviews }` snapshotting the two bundled
    # dimensions in order (auto-recorded as a `Gtd-Each:` trailer — no hand-
    # authored queue file).
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-gate → build.quality[0].reviewing"

    # A clean reviewing turn under the owasp-security lens (item 0) —
    # nothing blocking — advances straight to the next lens, in one decision.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality[0].reviewing → build.quality[1].reviewing"

    # A clean reviewing turn under the code-simplification lens (item 1, the
    # last) — the queue drains for real, straight to the exit check.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality[1].reviewing → build.quality-check"

    # quality-check's own script (a real DRIVER's job): .gtd/QUALITY.md was
    # never written -> writes .gtd/QUALITY_DONE.md and hands straight on to
    # the human review tail, never fix-quality.
    Given a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-check → build.review.reviewing"

  @inmem
  Scenario: a findings lap routes through fix-quality and back to the health check
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"
    And a commit "gtd(agent): build.health.check" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality-gate"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-gate → build.quality[0].reviewing"

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
    # A single-item snapshot drains for real straight to the exit check.
    And the last commit subject is "gtd(agent): build.quality[0].reviewing → build.quality-check"

    # quality-check's own script (a real DRIVER's job): .gtd/QUALITY.md has
    # a finding -> stamps it (keeping the finding) and writes
    # .gtd/QUALITY_DONE.md; both land together, first-match-wins routes this
    # to fix-quality, not the clean exit.
    Given ".gtd/QUALITY.md" is modified to:
      """
      ## Hardcoded secret in src/thing.ts

      `thing` embeds what looks like a credential inline — move it to an
      environment variable instead.

      <!-- gtd quality-check stamp -->
      """
    And a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-check → build.fix-quality"

    # fix-quality resolves the finding and deletes .gtd/QUALITY.md, handing
    # back to the health check — never straight to the human review.
    # .gtd/QUALITY_DONE.md stays: it is this episode's guard against
    # re-entering the lap, never this lap's own findings.
    Given the file ".gtd/QUALITY.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix-quality → build.health.check"

  @inmem
  Scenario: the quality lap runs to completion, unconditionally, ahead of the human review tail
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"
    And a commit "gtd(agent): build.health.check" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality-gate"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-gate → build.quality[0].reviewing"

    # A clean reviewing turn — nothing blocking under this one dimension —
    # drains for real (a single-item snapshot) straight to the exit check.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality[0].reviewing → build.quality-check"

    Given a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-check → build.review.reviewing"

  @inmem
  Scenario: a blank qualityReviews disables the lap — quality-gate's own clean tree chains straight through with no lens ever a rest
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a commit "gtd(agent): build.health.check" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality-gate"

    # `each: { var: qualityReviews }` resolves to an empty list -> chains
    # straight through to the exit check, in the same decision, with no
    # lens ever a rest.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-gate → build.quality-check"

    Given a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-check → build.review.reviewing"

  @inmem
  Scenario: the green route can never re-enter a drained lap — quality-gate short-circuits on .gtd/QUALITY_DONE.md
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"
    And a commit "gtd(agent): build.health.check" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality-gate"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-gate → build.quality[0].reviewing"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality[0].reviewing → build.quality-check"

    Given a file ".gtd/QUALITY_DONE.md" with:
      """
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-check → build.review.reviewing"

    # A later fix cycle re-triggers build.health, going green again in the
    # SAME episode — quality-gate must never re-run the lap.
    Given a commit "gtd(agent): build.fix" that adds "src/other.ts" with:
      """
      export const other = 1
      """
    And a commit "gtd(agent): build.health.check" that adds "src/other-2.ts" with:
      """
      export const otherTwo = 2
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality-gate"

    # quality-gate's own script (a real DRIVER's job): finds
    # .gtd/QUALITY_DONE.md already on disk and stamps it afresh — a real
    # diff every time, never a no-op the green route could stall on —
    # routing straight to the human review tail, no lens re-run.
    Given ".gtd/QUALITY_DONE.md" is modified to:
      """

      <!-- gtd quality-gate stamp -->
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-gate → build.review.reviewing"
    And the git log does not contain "build.quality[1]"

  @inmem
  Scenario: a feedback loop-back through packages-sweep clears a stale .gtd/QUALITY_DONE.md, so the quality lap re-enters on the next pass
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"

    # A prior episode already drained the lap clean; a feedback round then
    # looped back through re-unwind -> design -> architecture — entered
    # directly here (a fabricated commit history, same convention
    # `spec-review-judgments.feature` uses), since the states under test
    # don't care how the process got there. This commit rests the process
    # at architecture.decompose with the stale .gtd/QUALITY_DONE.md an
    # earlier episode left behind already on disk.
    And a file ".gtd/QUALITY_DONE.md" with:
      """
      <!-- gtd quality-check stamp from an earlier episode -->
      """
    And an empty commit "gtd(agent): architecture.decompose"

    # architecture.decompose's own turn: writes the fresh package.
    Given a file ".gtd/packages/01-widget.md" with:
      """
      Package: the widget factory.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.decompose → packages-sweep"

    # packages-sweep's own script (a real DRIVER's job, rendered and executed
    # for real by src/workflows/packagesSweepScript.test.ts — @inmem never
    # executes it, so its effect is given by hand here): the stale
    # .gtd/QUALITY_DONE.md a completed lap left behind is swept along with
    # the other four patterns, before the package queue is even entered.
    Given the file ".gtd/QUALITY_DONE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages-sweep → packages[0].building"
    And ".gtd/QUALITY_DONE.md" does not exist

    # Skip straight to the package's own health check going green — building
    # the package itself is covered elsewhere; the sweep's effect is what's
    # under test here.
    Given an empty commit "gtd(check): packages[0].closing → build.health.check"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.quality-gate"

    # quality-gate finds no .gtd/QUALITY_DONE.md (packages-sweep cleared the
    # stale one above) and re-enters the lap, rather than short-circuiting
    # straight to the human review tail.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-gate → build.quality[0].reviewing"

  @inmem
  Scenario: a second entry sweeps the previous episode's QUALITY_DONE.md, so the lap runs again instead of short-circuiting
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"
    # What a completed earlier episode leaves committed: `quality-check`
    # writes this marker when the lap drains, and only an entry check or
    # `packages-sweep` ever clears it.
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
    And the last commit subject is "gtd(check): build.health.check → build.quality-gate"

    # The marker is gone, so quality-gate re-enters the lap this time rather
    # than short-circuiting straight through to the review tail.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality-gate → build.quality[0].reviewing"
