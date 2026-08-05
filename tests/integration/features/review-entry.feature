@inmem
Feature: gtd review <commitish> — start a review process from an ordinary branch

  A workflow may declare `reviewEntry: true` on (at most) one state (STATES.md
  §1/§11). `gtd review <commitish>` starts a BRAND NEW gtd process there,
  reviewing `<commitish>..HEAD` — e.g. a colleague's PR branch pushed on top of
  a shared base, with no gtd process of its own — by writing ONE empty
  `gtd(human): <review-entry-state>` commit carrying the resolved base's full
  hash as a `Gtd-Review-Base:` trailer. Everything downstream (the `simple`
  template's `review.reviewing` → `review.await-review` → feedback laps, and the
  `await-review` review checkout window) then operates over that diff with no
  duplicated logic. The unified template declares `reviewEntry: true` on
  `review-gate.check` — the green-baseline gate that runs the suite and, once
  green, transitions to `review.reviewing`.

  Background:
    Given a test project
    And the workflow
    And I mark the current commit as "base"

  Scenario: happy path — a colleague's PR branch reviewed from its shared base, gated then resting at review.reviewing
    Given a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "review base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"
    And the last commit body contains "Gtd-Review-Base:"
    And the last commit body contains the hash of "base"
    # The green-baseline gate: a clean tree (tests pass) advances to review.reviewing.
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): review-gate.check → review.reviewing"
    When I run gtd next
    Then it succeeds
    And stdout contains "## Full diff under review"
    And stdout contains "src/calc.ts"
    And stdout contains "add = (a: number, b: number)"

  Scenario: fails with a clear usage error when the active workflow declares no review entry state
    Given a gtd config file at ".gtdrc" with:
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do it"
                on:
                  "* **": idle
      """
    When I run gtd with args "review base"
    Then it fails
    And stderr contains "declares no review entry state"

  Scenario: refuses on a dirty working tree, authoring nothing
    Given a file "scratch.txt" with:
      """
      not committed yet
      """
    And I record the commit count
    When I run gtd with args "review base"
    Then it fails
    And the commit count is unchanged

  Scenario: refuses when a gtd process is already underway
    Given a file ".gtd/TODO.md" with:
      """
      a sketch
      """
    And I run gtd step human
    And I record the commit count
    When I run gtd with args "review base"
    Then it fails
    And the commit count is unchanged

  Scenario: refuses when <commitish> is HEAD itself — nothing to review
    Given I record the commit count
    When I run gtd with args "review HEAD"
    Then it fails
    And the commit count is unchanged

  Scenario: refuses when <commitish> is not an ancestor of HEAD
    Given a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And I mark the current commit as "unrelated-tip"
    And I hard-reset to "base"
    And a commit "feat: add tests instead" that adds "src/calc.test.ts" with:
      """
      import { add } from "./calc"
      test("adds", () => expect(add(1, 2)).toBe(3))
      """
    And I record the commit count
    When I run gtd with args "review unrelated-tip"
    Then it fails
    And stderr contains "is not an ancestor of HEAD"
    And the commit count is unchanged

  Scenario: a later turn's diff still includes both the original PR change and a subsequent fix
    Given a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "review base"
    Then it succeeds
    # Simulate a fix landing in a later turn of the SAME process (never
    # crossing the idle boundary, so the process's diff base stays anchored
    # at "base") — the diff base is history-derived, not tied to any one
    # turn's own content.
    Given a commit "gtd(agent): review.reviewing" that adds "src/fix.ts" with:
      """
      export const fixed = true
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "src/calc.ts"
    And stdout contains "src/fix.ts"

  Scenario: squashing a review process describes only the review's own fixes (it.retainedDiff), not the reviewed changeset
    # The squash resets to the process's OWN boundary (startParentHash — the
    # reviewed commit), so its message must describe only what it keeps: the
    # fixes made DURING the review, not the whole changeset under review. That
    # base is never pushed back by the Gtd-Review-Base: trailer the way
    # it.processDiff's is.
    Given a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "review base"
    Then it succeeds
    # A fix authored during the review, then the human signs off into squashing.
    Given a commit "gtd(agent): review.reviewing" that adds "src/fix.ts" with:
      """
      export const fixed = true
      """
    And an empty commit "gtd(human): review.reviewing → squashing"
    When I run gtd next
    Then it succeeds
    And stdout contains "## Retained diff"
    And stdout contains "src/fix.ts"
    And stdout does not contain "src/calc.ts"

  Scenario: a clean review sign-off with no fixes squashes to a "chore: human review" commit
    Given a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "review base"
    Then it succeeds
    # No fix authored — the human signs off straight into squashing.
    And an empty commit "gtd(human): review.reviewing → squashing"
    When I run gtd next
    Then it succeeds
    And stdout contains "chore: human review"
    And stdout does not contain "## Retained diff"
    And stdout does not contain "src/calc.ts"

  Scenario: the review checkout window at await-review spans <commitish>..HEAD
    Given a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And I run gtd with args "review base"
    And a commit "gtd(agent): review.await-review" that adds ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1 — looks good
      """
    When I run gtd next
    Then it succeeds
    And the git ref "refs/worktree/gtd/review-head" exists
    # HEAD rests at "base" — the process's diff base — surfacing the whole
    # <commitish>..HEAD diff as ordinary uncommitted changes.
    And the last commit subject is "chore: init gtd workflow"
    And the git status contains "src/calc.ts"
