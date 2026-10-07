Feature: the qualitative review lap (.gtd/packages/01-quality-review-lap.md)

  `build.quality` sits between the green health check and the human review
  tail: one `build.quality.<lens>.reviewing` agent turn per comma-separated
  `qualityReviews` lens, in the order listed, each its own scope loading only its own
  lens skill, naming its own lens and
  APPENDING every finding, blocking or not, to `.gtd/QUALITY.md`. Once every lens has
  had its turn, a non-empty `.gtd/QUALITY.md` routes to `build.fix.quality.fixing`;
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
  Scenario: six lenses each get one reviewing turn in listed order, then the clean lap hands straight on to the human review
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
    And the last commit subject is "gtd(check): build.health.check → build.quality.correctness.reviewing"

    # The bundled lenses, in order: correctness, owasp-security, ponytail-review, test-audit, conventions, spec-challenge.
    When I run gtd next
    Then it succeeds
    And stdout contains "`correctness`"
    When I run gtd next with "--json=skills.0"
    Then it succeeds
    And stdout contains "code-review-and-quality"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout does not contain "owasp-security"

    # A clean reviewing turn under this lens — nothing found.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.correctness.reviewing → build.quality.owasp-security.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`owasp-security`"
    And stdout does not contain "`correctness`"
    When I run gtd next with "--json=skills"
    Then it succeeds
    And stdout contains "owasp-security"
    And stdout does not contain "code-review-and-quality"

    # A clean reviewing turn under this lens — nothing found.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.owasp-security.reviewing → build.quality.ponytail-review.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`ponytail-review`"
    And stdout does not contain "`owasp-security`"

    # A clean reviewing turn under this lens — nothing found.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.ponytail-review.reviewing → build.quality.test-audit.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`test-audit`"
    And stdout does not contain "`ponytail-review`"

    # A clean reviewing turn under this lens — nothing found.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.test-audit.reviewing → build.quality.conventions.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`conventions`"
    And stdout does not contain "`test-audit`"

    # A clean reviewing turn under this lens — nothing found.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.conventions.reviewing → build.quality.spec-challenge.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`spec-challenge`"
    And stdout does not contain "`conventions`"

    # The final lens is clean too: with .gtd/QUALITY.md never written, the
    # lap hands straight on to the human review tail, never build.fix.quality.fixing.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.spec-challenge.reviewing → build.review.reviewing"

  @inmem
  Scenario: a findings lap routes through build.fix.quality.fixing and the health check, then straight on to the human review
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
    And the last commit subject is "gtd(check): build.health.check → build.quality.owasp-security.reviewing"

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
    And the last commit subject is "gtd(agent): build.quality.owasp-security.reviewing → build.fix.quality.fixing"

    # build.fix.quality.fixing's prompt names its bundled skills — grounds this
    # step's own map key against the real scoped name it resolves to.
    When I run gtd next
    Then stdout contains "incremental-implementation, code-simplification"

    # build.fix.quality.fixing resolves the finding, deletes .gtd/QUALITY.md, and hands
    # back to the health check — never straight to the human review.
    Given the file ".gtd/QUALITY.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.fix.quality.fixing → build.health.check"

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
  Scenario: lenses are trimmed and reviewed one turn each, and a lens's finding routes to build.fix.quality.fixing
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
    And gtd lands "gtd(check): build.health.check → build.quality.first-lens.reviewing"
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
    And the last commit subject is "gtd(agent): build.quality.first-lens.reviewing → build.quality.second-lens.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "`second-lens`"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.second-lens.reviewing → build.fix.quality.fixing"
    And ".gtd/QUALITY.md" contains "A blocking finding"

  @inmem
  Scenario: conventions loads no skill and its brief reaches the prompt
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "conventions"
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
    When I run gtd next
    Then it succeeds
    And stdout contains "AGENTS.md"
    And stdout contains "quote the"
    And stdout does not contain "Load whatever's listed here"

  @inmem
  Scenario: correctness loads code-review-and-quality
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
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
    When I run gtd next
    Then it succeeds
    And stdout contains "missing one: code-review-and-quality"
    And stdout contains "partial-failure"

  @inmem
  Scenario: a non-blocking finding still routes to build.fix.quality.fixing
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to "ponytail-review"
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
    Given a file ".gtd/QUALITY.md" with:
      """
      ## Nit: `thing` could be inlined

      Minor style note, not blocking.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): build.quality.ponytail-review.reviewing → build.fix.quality.fixing"

  @inmem
  Scenario: a lens skills key loads only while the lens is in qualityReviews
    Given a test project
    And the workflow
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        qualityReviews: "owasp-security"
      skills:
        build.quality.ponytail-review: [my-org-checklist]
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd config:"
    And stderr contains "\"skills.build.quality.ponytail-review\" is not a scope that runs a turn"

    Given a gtd config file at ".gtdrc" with:
      """
      vars:
        qualityReviews: "owasp-security, ponytail-review"
      skills:
        build.quality.ponytail-review: [my-org-checklist]
      """
    When I run gtd next
    Then it succeeds
