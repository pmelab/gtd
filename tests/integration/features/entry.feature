@inmem
Feature: gtd --entry <name> — start a brand new process the workflow opens for a name

  `gtd --entry <name>` (always authenticated as `human`) starts a process with
  the workflow's flow receiving `{ entry: "<name>" }`; an ordinary start passes
  `undefined`. The flow decides what each name means and `refuse()`s the names
  it does not accept; a flow that never reads `entry` accepts none. The name is
  recorded on the opening commit, so every later command replays the flow with
  the same entry. Repeatable `--var <name>=<value>` supplies that process's
  fixed vars, which must already be declared by the workflow's own `vars` (or
  `.gtdrc` `vars:`).

  The bundled workflow accepts `review-gate.check`, `fix-precheck` and
  `start-gate.check`. `review-gate.check` fixes the whole process's diff base
  to whatever `--var reviewBase=<commitish>` names; the default empty string
  is refused, so a review entry always requires an explicit `--var
  reviewBase=<commitish>`. `fix-precheck` needs no `--var`.

  Resting at the initial state is required — a process already underway
  refuses. The working tree need not be clean: whatever it carries is CAPTURED
  into the entry commit, exactly like an ordinary `gtd land`.

  Background:
    Given a test project
    And the workflow

  Scenario: happy path — a local branch entered for review via the space-separated "--entry" form, gated then resting at build.review.reviewing
    Given I mark the current commit as "base"
    # A blank qualityReviews skips the lap review-gate now hands to — this
    # scenario is about the entry mechanics, not about the lap.
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "--entry review-gate.check --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"
    # The green-baseline gate: a clean tree (tests pass) advances into the
    # quality lap — the review pre-judge fast path was removed. With the lap
    # disabled here, seeding hands straight on to build.review.reviewing.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): review-gate.check → build.quality.seeding"
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.quality.seeding → build.review.reviewing"
    When I run gtd next
    Then it succeeds
    # The reviewing prompt NAMES the fixed base rather than inlining its diff.
    And stdout contains the hash of "base"
    And stdout does not contain "## Full diff under review"
    And stdout does not contain "diff --git"

  Scenario: the "--entry=<state>" equals-sign form works identically to the space-separated form
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "--entry=review-gate.check --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"

  Scenario: gtd --entry fix-precheck also enters the fix-entry gate — see fix-entry.feature for the deep coverage
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"

  Scenario: a dirty working tree is captured into the entry commit, not refused
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "scratch.txt" with:
      """
      not committed yet
      """
    When I run gtd with args "--entry review-gate.check --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"

  Scenario: fails with a clear usage error when the state name is not declared
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "go" })
        await agent("working", "do it")
      })
      """
    When I run gtd with args "--entry review-gate.check"
    Then it fails
    And stderr contains "is not an enterable state"

  Scenario: refuses entering a commit state — a commit state is never enterable
    When I run gtd with args "--entry done"
    Then it fails
    And stderr contains "is not an enterable state"

  Scenario: refuses when a gtd process is already underway
    Given a file "NOTE.md" with:
      """
      a sketch
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "--entry review-gate.check"
    Then it fails
    And stderr contains "a process is already underway"
    And the commit count is unchanged

  Scenario: refuses an undeclared "--var" name
    When I run gtd with args "--entry review-gate.check --var bogus=1"
    Then it fails
    And stderr contains "--var name(s) not declared by this workflow"

  Scenario: refuses entering the review gate with no "reviewBase" var supplied — the default renders blank
    When I run gtd with args "--entry review-gate.check"
    Then it fails
    And stderr contains "'s reviewBase template rendered blank — template:"

  Scenario: refuses a "reviewBase" that is not an ancestor of HEAD
    Given a commit "feat: shared work" that adds "shared.txt" with:
      """
      shared
      """
    And I mark the current commit as "shared"
    And a commit "feat: branch a work" that adds "a.txt" with:
      """
      a
      """
    And I mark the current commit as "branch-a"
    And I hard-reset to "shared"
    And a commit "feat: branch b work" that adds "b.txt" with:
      """
      b
      """
    When I run gtd with args "--entry review-gate.check --var reviewBase=branch-a"
    Then it fails
    And stderr contains "is not an ancestor of HEAD"

  Scenario: refuses a "reviewBase" that resolves to HEAD — nothing to review
    Given I mark the current commit as "here"
    When I run gtd with args "--entry review-gate.check --var reviewBase=here"
    Then it fails
    And stderr contains "is HEAD — nothing to review"

  Scenario: the flow receives the entry name as its argument, and every later command replays with it
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async ({ entry }) => {
        if (entry === undefined) {
          await human("idle", { message: "go" })
          return
        }
        if (!entry.startsWith("hotfix-")) refuse(`"${entry}" is not an enterable state`)
        await agent("patch", `Patch ${entry.slice("hotfix-".length)}.`)
        await agent("verify", `Verify the ${entry} patch.`)
      })
      """
    When I run gtd with args "--entry hotfix-login"
    Then it succeeds
    And the last commit subject is "gtd(human): hotfix-login"
    When I run gtd next
    Then it succeeds
    And stdout contains "Patch login."
    Given a file "fix.txt" with:
      """
      fixed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): patch → verify"
    When I run gtd next
    Then it succeeds
    And stdout contains "Verify the hotfix-login patch."

  Scenario: a name the flow refuses is refused with the flow's own message, and nothing is committed
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async ({ entry }) => {
        if (entry !== undefined && entry !== "hotfix") refuse(`"${entry}" is not an enterable state`)
        if (entry === undefined) await human("idle", { message: "go" })
        await agent("patch", "Patch it.")
      })
      """
    And I record the commit count
    When I run gtd with args "--entry release"
    Then it fails
    And stderr contains "gtd --entry release: \"release\" is not an enterable state"
    And the commit count is unchanged

  Scenario: a workflow whose flow never reads its entry accepts no --entry
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "go" })
        await agent("working", "do it")
      })
      """
    And I record the commit count
    When I run gtd with args "--entry working"
    Then it fails
    And stderr contains "this workflow reads no entry"
    And the commit count is unchanged
