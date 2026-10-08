@inmem
Feature: gtd --workflow <name> — start a brand new process on a named workflow

  `gtd --workflow <name>` (always authenticated as `human`) starts a process on
  the named workflow; an ordinary start runs the default. Every exported
  function of a `gtd.config.ts` is a workflow named by its export, and the
  bundled `feature`, `review` and `fix` stay startable beside them. The
  workflow's name is recorded on the opening commit (`Gtd-Workflow:`), so every
  later command replays that workflow. Repeatable `--var <name>=<value>`
  supplies that process's fixed vars, which must already be declared by the
  workflow file's `defaults` (or `.gtdrc` `vars:`).

  `review` fixes the whole process's diff base to the merge-base of `--var
  reviewBase=<commitish>` and HEAD; the default empty string means the default
  branch (`origin/HEAD`, else `main`). A base with nothing between it and HEAD
  is refused. `fix` needs no `--var`.

  Resting at the initial state is required — a process already underway
  refuses. The working tree need not be clean: whatever it carries is CAPTURED
  into the opening commit, exactly like an ordinary `gtd land`.

  Background:
    Given a test project
    And the workflow

  Scenario: happy path — a local branch started for review via the space-separated "--workflow" form, gated then resting at build.review.reviewing
    Given I mark the current commit as "base"
    # A blank qualityReviews skips the lap review-gate now hands to — this
    # scenario is about the entry mechanics, not about the lap.
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "--workflow review --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"
    # The green-baseline gate: a clean tree (tests pass) advances into the
    # quality lap — the review pre-judge fast path was removed. With the lap
    # disabled here, the gate hands straight on to build.review.reviewing.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): review-gate.check → build.review.reviewing"
    When I run gtd next
    Then it succeeds
    # The reviewing prompt NAMES the fixed base rather than inlining its diff.
    And stdout contains the hash of "base"
    And stdout does not contain "## Full diff under review"
    And stdout does not contain "diff --git"

  Scenario: the "--workflow=<name>" equals-sign form works identically to the space-separated form
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "--workflow=review --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"
  Scenario: a dirty working tree is captured into the opening commit, not refused
    Given I mark the current commit as "base"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "scratch.txt" with:
      """
      not committed yet
      """
    When I run gtd with args "--workflow review --var reviewBase=base"
    Then it succeeds
    And the last commit subject is "gtd(human): review-gate.check"

  Scenario: an unknown workflow name is a usage error listing every startable name
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
        await agent("working", "do it")
      }

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }
      """
    And I record the commit count
    When I run gtd with args "--workflow release"
    Then the exit code is 2
    And stderr contains "gtd --workflow: unknown workflow \"release\" — startable: feature, fix, hotfix, review"
    And the commit count is unchanged

  Scenario: "default" is not a startable name
    When I run gtd with args "--workflow default"
    Then the exit code is 2
    And stderr contains "unknown workflow"

  Scenario: "--entry" is gone — an ordinary unknown flag
    When I run gtd with args "--entry review-gate.check"
    Then the exit code is 2
    And stderr contains "unknown option '--entry'"

  Scenario: refuses when a gtd process is already underway
    Given a file "NOTE.md" with:
      """
      a sketch
      """
    And I run gtd land
    And I record the commit count
    When I run gtd with args "--workflow review"
    Then it fails
    And stderr contains "a process is already underway"
    And the commit count is unchanged

  Scenario: refuses an undeclared "--var" name
    When I run gtd with args "--workflow review --var bogus=1"
    Then it fails
    And stderr contains "--var name(s) not declared by this workflow"

  Scenario: a blank "reviewBase" reviews since the default branch's merge-base
    Given I mark the current commit as "main"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd with args "--workflow review"
    Then it succeeds
    And stdout contains the hash of "main"
    And the last commit subject is "gtd(human): review-gate.check"

  Scenario: a blank "reviewBase" with nothing beyond the default branch is refused — nothing to review
    When I run gtd with args "--workflow review"
    Then it fails
    And stderr contains "nothing to review: HEAD has no commits beyond main"

  Scenario: a "reviewBase" on a diverged branch pins the merge-base, not the named tip
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
    When I run gtd with args "--workflow review --var reviewBase=branch-a"
    Then it succeeds
    And stdout contains the hash of "shared"
    And stdout does not contain the hash of "branch-a"

  Scenario: refuses a "reviewBase" that does not resolve
    When I run gtd with args "--workflow review --var reviewBase=no-such-ref"
    Then it fails
    And stderr contains "\"no-such-ref\" does not resolve to a commit"

  Scenario: refuses a "reviewBase" that resolves to HEAD — nothing to review
    Given I mark the current commit as "here"
    When I run gtd with args "--workflow review --var reviewBase=here"
    Then it fails
    And stderr contains "nothing to review: HEAD has no commits beyond here"

  Scenario: two exported functions plus a default — "--workflow hotfix" starts hotfix, an ordinary start runs the default, and every later command replays on the pinned workflow
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = async () => {
        await agent("patch", "Patch the login.")
        await agent("verify", "Verify the patch.")
      }

      export const release = async () => {
        await agent("tag", "Tag it.")
      }
      """
    When I run gtd with args "--workflow hotfix"
    Then it succeeds
    And the last commit subject is "gtd(human): patch"
    And the last commit body contains "Gtd-Workflow: hotfix"
    When I run gtd next
    Then it succeeds
    And stdout contains "Patch the login."
    When I run gtd next with "--json=workflow"
    Then it succeeds
    And stdout contains "hotfix"
    Given a file "fix.txt" with:
      """
      fixed
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): patch → verify"
    When I run gtd next
    Then it succeeds
    And stdout contains "Verify the patch."

  Scenario: an ordinary start runs the default export, and status names it "default"
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = async () => {
        await human("patching", { message: "patch" })
      }
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"
    And stdout contains "Workflow: default"

  Scenario: a repo exporting only hotfix keeps the bundled feature for an ordinary start, and the bundled fix stays startable
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"
    And stdout contains "Workflow: feature"
    When I run gtd with args "--workflow fix"
    Then it succeeds
    And the last commit subject is "gtd(human): fix-precheck"
    And the last commit body contains "Gtd-Workflow: fix"

  Scenario: a repo's own review shadows the bundled review
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const review = async () => {
        await agent("my-review", "My own review.")
      }
      """
    When I run gtd with args "--workflow review"
    Then it succeeds
    And the last commit subject is "gtd(human): my-review"

  Scenario: a helper re-exported from the bundled module is a startable workflow
    Given a gtd config file at "gtd.config.ts" with:
      """
      export { unwind } from "@pmelab/gtd/workflow"
      """
    When I run gtd with args "--workflow unwind"
    Then it succeeds
    And the last commit body contains "Gtd-Workflow: unwind"

  Scenario: removing the pinned export mid-process is refused with the abandon advice
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }
      """
    And I run gtd with args "--workflow hotfix"
    And "gtd.config.ts" is modified to:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "runs workflow \"hotfix\", which gtd.config.ts no longer defines"
    And stderr contains "gtd abandon"

  Scenario: editing the default mid-process does not change the pinned workflow
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "go" })
      }

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }
      """
    And I run gtd with args "--workflow hotfix"
    And "gtd.config.ts" is modified to:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("something-else", { message: "go" })
      }

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
      }
      """
    When I run gtd next with "--json=state"
    Then it succeeds
    And stdout contains "patch"

  Scenario: an opening commit with no Gtd-Workflow trailer replays on the default and diverges with the abandon advice
    # The same history is valid once the opening commit carries the trailer;
    # missing trailer is the only divergence.
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export const hotfix = async () => {
        await agent("patch", "Patch it.")
        await agent("verify", "Verify it.")
      }
      """
    And a commit "gtd(human): patch" that adds "NOTE.md" with:
      """
      legacy
      """
    And a commit "gtd(agent): patch → verify\n\nGtd-Step: patch#1" that adds "other.txt" with:
      """
      other
      """
    When I run gtd next
    Then it fails
    And stderr contains "replay expected \"idle#1\""
    And stderr contains "gtd abandon"
