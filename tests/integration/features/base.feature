Feature: gtd base — prints the review anchor hash, writing nothing

  `gtd base` prints the review base bare and newline-terminated —
  the most-recent in-process commit that entered a `reviewBase: true` step, or the
  process's diff base when none has landed yet. It exists so an external
  tool (a diff, a PR tool, another agent) can be pointed at the range under
  review; gtd never reads the result back. Shaped exactly like `summary`:
  one `Rest` resolved, nothing written. It refuses (exit 1) when no process
  is underway — the only case where the hash would name a range that
  corresponds to no review.

  @inmem
  Scenario: gtd base tracks the process's diff base, then each review round's own boundary
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, changed, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        for (;;) {
          await agent("building", "build it")
          await human("awaiting-review", {
            label: "Awaiting your review",
            message: "leave FEEDBACK.md for changes, or touch SIGNOFF.md to sign off",
          })
          await human("deciding", {
            reviewBase: true,
            acceptClean: true,
            message: "sign off (clean tree) or send back for changes",
          })
          if (added("FEEDBACK.md").length > 0) continue
          if (changed().length === 0) return
          refuse("deciding: add FEEDBACK.md or land a clean tree")
        }
      })
      """
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"

    # Before the first review round: gtd base names the process's diff base.
    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "boundary"

    Given a file "src/a.ts" with:
      """
      export const a = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → awaiting-review"

    # Mid-planning, resting at `awaiting-review`: still the process's diff
    # base, since no `deciding` round has landed yet.
    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "boundary"

    # Sign off — touch a file to leave a pending change (the resting state
    # declares no `C` row, so a genuinely clean tree would be a no-op here)
    # and land the round's own `deciding` commit.
    Given a file "SIGNOFF.md" with:
      """
      looks good
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): awaiting-review → deciding"
    And I mark the current commit as "first-round"

    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "first-round"
    And stdout does not contain the hash of "boundary"

    # A second, incremental round: request changes via FEEDBACK.md.
    Given a file "FEEDBACK.md" with:
      """
      please tweak this
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): deciding → building"

    # Back in `building`, mid the second lap — gtd base now names the
    # PREVIOUS round's boundary, not the process start.
    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "first-round"
    And stdout does not contain the hash of "boundary"

    Given a file "src/a.ts" with:
      """
      export const a = 2
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): building → awaiting-review"

    Given a file "SIGNOFF2.md" with:
      """
      looks good this time too
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): awaiting-review → deciding"
    And I mark the current commit as "second-round"

    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "second-round"
    And stdout does not contain the hash of "first-round"

    # Sign off for good — the process closes and HEAD rests at the initial
    # state again.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): deciding → idle"

    When I run gtd with args "base"
    Then it fails
    And stdout is empty
    And stderr contains "gtd base: refused"

  @inmem
  Scenario: gtd base refuses on a fresh idle repo — no process underway
    Given a test project
    And the workflow
    When I run gtd with args "base"
    Then it fails
    And stdout is empty
    And stderr contains "gtd base: refused"

  @inmem
  Scenario: On the bundled workflow, gtd base agrees with the review round's own base marker and range
    # Reaches `build.review.reviewing` by the shortest real history: two
    # feature commits build up the reviewable diff, then `--entry
    # review-gate.check` fixes the review base at "boundary" (the quality lap
    # disabled).
    Given a test project
    And the workflow
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And I mark the current commit as "boundary"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "feat: add helper" that adds "src/other.ts" with:
      """
      export const untouched = () => true
      """
    And gtd enters "review-gate.check" with "--var reviewBase=boundary"
    And gtd lands "gtd(check): review-gate.check → build.quality.seeding"
    And gtd lands "gtd(check): build.quality.seeding → build.review.reviewing"
    # The reviewing prompt makes the agent write this marker verbatim as
    # `refs.reviewBase` (src/workflows/text.ts). BASE here is
    # substituted for the real hash "boundary" resolves to — not typed by
    # this scenario — so the assertions below compare `gtd base`'s output
    # against a value this scenario did not itself supply: two independently
    # derived renderings of the one true commit, one via the doc, one via
    # `reviewBaseFor`.
    And a file ".gtd/REVIEW.md" with the hash of "boundary" substituted for "BASE":
      """
      # Review: abc1234

      <!-- base: BASE -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function

      ## other
      - [ ] ./src/other.ts#1
      untouched helper
      """
    When I run gtd land
    Then it succeeds

    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "boundary"
    And ".gtd/REVIEW.md" contains the hash of "boundary"
    # The actual range check: `git diff --name-only` against the printed base
    # names exactly the paths the doc's two hunk pointers name — nothing more,
    # nothing less.
    And git diff --name-only against "boundary" names exactly:
      """
      src/calc.ts
      src/other.ts
      """

  @live
  Scenario: gtd base writes nothing — the repository is byte-identical before and after the call
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      })
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"

    Given the git index has settled
    And I snapshot the repository
    When I run gtd with args "base"
    Then it succeeds
    And the repository snapshot is unchanged

  @inmem
  Scenario: gtd base prints exactly one hash plus a newline — no label, no surrounding text
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      })
      """
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd with args "base"
    Then it succeeds
    And stdout matches "^[0-9a-f]{7,40}\n$"
