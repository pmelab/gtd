Feature: the qualitative review lap (.gtd/packages/01-quality-review-lap.md)

  `build.quality` sits between the green health check and the human review
  tail: one `build.quality.reviewing` agent turn per comma-separated
  `qualityReviews` lens, in the order listed, each naming its own lens and
  APPENDING any blocking finding to `.gtd/QUALITY.md`. Once every lens has
  had its turn, a non-empty `.gtd/QUALITY.md` routes to `build.fix-quality`;
  otherwise the lap hands straight on to `build.review.reviewing`. The lap
  runs once per build tail: after its findings are fixed and the suite is
  green again, the human review follows directly.

  Every scenario reaches `build.health.check` through a real
  `--entry fix-precheck` history (a red precheck, then one fix turn) and
  fabricates each later turn's own resulting diff by hand — same convention
  as `default-workflow.feature` and `spec-review-judgments.feature` — since
  no real driver runs a script or an agent in this harness; only gtd's own
  routing is under test.

  @inmem
  Scenario: three lenses each get one reviewing turn in listed order, then the clean lap hands straight on to the human review
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
    And the last commit subject is "gtd(check): build.health.check → build.quality.reviewing"

    # The bundled lenses, in order: owasp-security, ponytail-review, test-audit.
    When I run gtd next
    Then it succeeds
    And stdout contains "`owasp-security`"
    And stdout does not contain "`ponytail-review`"
    And stdout does not contain "`test-audit`"

    # A clean reviewing turn under the owasp-security lens — nothing blocking.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`ponytail-review`"
    And stdout does not contain "`owasp-security`"
    And stdout does not contain "`test-audit`"

    # A clean reviewing turn under the ponytail-review lens too.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`test-audit`"
    And stdout does not contain "`owasp-security`"
    And stdout does not contain "`ponytail-review`"

    # A clean reviewing turn under the final, test-audit lens: with
    # .gtd/QUALITY.md never written, the lap hands straight on to the human
    # review tail, never fix-quality.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.review.reviewing"

  @inmem
  Scenario: a findings lap routes through fix-quality and the health check, then straight on to the human review
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
    And the last commit subject is "gtd(check): build.health.check → build.quality.reviewing"

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
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.fix-quality"

    # build.fix-quality's prompt names its bundled skills — grounds this
    # step's own map key against the real scoped name it resolves to.
    When I run gtd next
    Then stdout contains "incremental-implementation, code-simplification"

    # fix-quality resolves the finding, deletes .gtd/QUALITY.md, and hands
    # back to the health check — never straight to the human review.
    Given the file ".gtd/QUALITY.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix-quality → build.health.check"

    # Green again: the lap already ran this tail, so review follows directly.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"

  @inmem
  Scenario: a blank qualityReviews disables the lap — the green health check hands straight on
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
    And the last commit subject is "gtd(check): build.health.check → build.review.reviewing"
    And the git log does not contain "build.quality"

  @live
  Scenario: lenses are trimmed and reviewed one turn each, and a lens's finding routes to fix-quality
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to " first-lens , second-lens "
    And gtd enters "fix-precheck"
    And a file ".gtd/FEEDBACK.md" with:
      """
      1 failing test
      """
    And gtd lands "gtd(check): fix-precheck → build.fix"
    And the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And gtd lands "gtd(check): build.health.check → build.quality.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`first-lens`"
    Given a file ".gtd/QUALITY.md" with:
      """
      ## A blocking finding

      Under the first lens.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`second-lens`"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.reviewing → build.fix-quality"
    And ".gtd/QUALITY.md" contains "A blocking finding"
