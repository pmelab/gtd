Feature: gtd in a repository with no commits yet

  The unborn-HEAD precondition case: `rest.context.currentCommit` is `""` for
  a repository with no commits, and `src/Emit.ts`'s `headAssertion` treats
  `""` as its own first-class value for "no commits yet" rather than a hash
  standing in for it — so the very first `gtd step` in a freshly `git init`'d
  project is allowed to land. Covered on both tiers: the @live scenario is
  what would have caught the original bug (a bare `git rev-parse HEAD` prints
  the literal string `HEAD` plus a `fatal:` line against an unborn HEAD, never
  an empty string), and the @inmem twin keeps `EmittedScriptRecognizer.ts`
  honest about modelling that same behavior.

  @live
  Scenario: the first gtd step lands in a repository with no commits
    Given a git repository with no commits
    And a file ".gtd/TODO.md" with:
      """
      build a thing
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-gate.check"

  @inmem
  Scenario: the first gtd step lands in a repository with no commits (scripted)
    Given a git repository with no commits
    And a file ".gtd/TODO.md" with:
      """
      build a thing
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): idle → plan-gate.check"
