@live
Feature: the review scripts exclude stateDir/reviewFile by literal path, not by pattern (issue #128 follow-up)

  `build.review.deciding`'s check script (`src/workflows/unified.yaml`) used to
  decide sign-off vs. feedback with `grep -v "^$stateDir/"` — a plain grep
  interprets `$stateDir` as a POSIX basic regular expression, not a literal
  path. With the DEFAULT `stateDir` of `.gtd`, the pattern `^.gtd/` also
  matches `agtd/` (`.` matches any character), so a genuine hand-edit under a
  sibling `agtd/` directory was silently dropped from the hand-edit test and a
  round with real feedback content misread as a clean sign-off. No unusual
  `stateDir` spelling is needed to trigger this — the default is already a
  regex here. The fix replaces the grep filter with git's own
  `:(exclude,literal)` pathspec magic on the `git diff-tree` invocation, which
  matches `stateDir` and `reviewFile` as literal paths.

  This scenario actually EXECUTES the rendered script (`I execute the printed
  check script`) rather than simulating its outcome by hand — the bug lives in
  the script's own shell logic, which `@inmem` scenarios never run (see
  AGENTS.md). It is a separate feature file from `review-signoff-outside-gtd.feature`
  because that file's subject is a `reviewFile` repointed outside `.gtd/`, a
  different cause from this one's default-`stateDir`-as-regex bug.

  The second scenario is the same class of bug in the OTHER script that
  renders the same two values into a pathspec — `re-unwind`'s scoped
  `git diff | git apply -R`. That one used a bare `:(exclude)`, and git's
  DEFAULT pathspec magic is glob-ish (`*` even crosses `/`), so a
  metacharacter in either value silently widened the exclusion. Nothing
  validates one out: `stateDirError` rejects blanks/root/absolute/`..`/
  non-canonical segments only, and `reviewFile` is an ordinary var. Unlike
  the grep bug above, the default spellings are safe here — an unusual (but
  permitted) value is needed to trigger it.

  Scenario: a hand-edit under a sibling "agtd/" directory is feedback, not a clean sign-off
    Given a test project
    And a commit "gtd(agent): build.health.check → build.review.reviewing" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [x] ./src/calc.ts#1
      new add function
      """
    And a file "agtd/notes.md" with:
      """
      Sibling-directory note the human left alongside the review — not under
      .gtd/, so it must count as a real hand-edit.
      """
    And the working tree is committed as "gtd(human): build.review.await-review → build.review.deciding"
    When I run gtd status with "--json"
    And I execute the printed check script
    And I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.review.collecting"

  Scenario: re-unwind reverts a code path a glob-y stateDir would otherwise have swallowed
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        stateDir: state*
      """
    And a file "state-machine.ts" with:
      """
      export const state = 1
      """
    And the working tree is committed as "gtd(agent): build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Chunk
      - [ ] ./state-machine.ts#1
      """
    And the working tree is committed as "gtd(check): build.review.reviewing → build.review.await-review"
    # The human's round hand-edits real code whose PATH the relocated
    # `stateDir` glob happens to cover (`state*` wildmatches
    # `state-machine.ts`), plus a scratch note under the relocated plumbing
    # directory itself.
    Given "state-machine.ts" is modified to:
      """
      export const state = 1
      // TODO: also export a stopped state
      """
    And the file ".gtd/REVIEW.md" is deleted
    And a file "state*/marker.md" with:
      """
      keep this — under the relocated stateDir, must survive the revert
      """
    And the working tree is committed as "gtd(human): build.review.await-review → build.review.deciding"
    And an empty commit "gtd(agent): build.review.collecting → re-unwind"
    When I run gtd status with "--json"
    Then it succeeds
    And I execute the printed check script
    # With a bare `:(exclude)`, `state-machine.ts` fell out of the patch, the
    # reverse-apply was a no-op, and the require-revert guard (a plain string
    # comparison, which still scores that path as code) refused this land
    # forever. `:(exclude,literal)` excludes only the directory literally
    # named `state*` — so the code reverts and the scratch note survives.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): re-unwind → design.triage"
    And "state-machine.ts" does not contain "TODO"
    And "state*/marker.md" exists
