Feature: gtd base — prints the review anchor hash, writing nothing

  `gtd base` prints the review base bare and newline-terminated —
  the `base` the resting step names, or the process's diff base when it
  names none. It exists so an external
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
      import { agent, changes, head, human, refuse, start } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        let base = start()
        for (;;) {
          await agent("building", "build it", { base })
          await human("awaiting-review", {
            label: "Awaiting your review",
            message: "leave FEEDBACK.md for changes, or touch SIGNOFF.md to sign off",
            base,
          })
          base = head()
          await human("deciding", {
            base,
            acceptClean: true,
            message: "sign off (clean tree) or send back for changes",
          })
          if (changes("FEEDBACK.md").some((c) => c.status === "added")) continue
          if (changes().length === 0) return
          refuse("deciding: add FEEDBACK.md or land a clean tree")
        }
      }
      """
    And I mark the current commit as "boundary"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → building"
    And I run the pin beat

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

    # Sign off for good — the process closes, the unpin beat lands the
    # closing commit, and HEAD rests at the initial state again.
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): deciding → gtd:unpin"
    And I run the unpin beat
    And the last commit subject is "gtd(check): gtd:unpin → idle"

    When I run gtd with args "base"
    Then it fails
    And stdout is empty
    And stderr contains "gtd base: refused"

  @inmem
  Scenario: gtd base refuses on a fresh idle repo — no process underway
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }
      """
    When I run gtd with args "base"
    Then it fails
    And stdout is empty
    And stderr contains "gtd base: refused"

  @inmem
  Scenario: gtd base names the diff base a started workflow's base export fixes, and that range is the reviewed one
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      const defaults = { reviewBase: "" }
      const base = (workflow, vars) => (workflow === "review" ? vars.reviewBase : undefined)

      export default workflow(async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
      }, { defaults, base })

      export const review = workflow(async function review() {
        await agent("reviewing", "review the branch into REVIEW.md")
        await human("await-review", { message: "read REVIEW.md" })
      }, { defaults, base })
      """
    And I mark the current commit as "boundary"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "feat: add helper" that adds "src/other.ts" with:
      """
      export const untouched = () => true
      """
    When I run gtd with args "start review --var reviewBase=boundary"
    Then it succeeds
    And the last commit subject is "gtd(human): reviewing"
    And I run the pin beat

    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "boundary"
    And git diff --name-only against "boundary" names exactly:
      """
      src/calc.ts
      src/other.ts
      """

    Given a file "REVIEW.md" with:
      """
      - [ ] ./src/calc.ts#1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): reviewing → await-review"
    When I run gtd with args "base"
    Then it succeeds
    And stdout contains the hash of "boundary"

  @inmem
  Scenario: gtd base writes nothing — the repository is byte-identical before and after the call
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }
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
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("building", "build it")
      }
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
