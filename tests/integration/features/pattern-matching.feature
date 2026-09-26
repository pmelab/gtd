@inmem
Feature: Pattern-matching grammar — statuses, glob depth, declaration order, clean event

  A flow branches on what a landing changed with the `added`/`modified`/
  `deleted`/`changed` helpers, each optionally filtered by a glob (`*` stays
  within one path segment, `**` crosses them). Branches are plain code, so
  the first one that matches in code order wins; a landing no branch
  explains is refused with `refuse(message)`. A clean landing completes a
  human gate only when it declares `acceptClean` — otherwise it is a silent
  no-op. Each scenario declares a minimal `gtd.config.ts` isolating one
  concern so the helper under test is the only thing that could make it pass
  or fail.

  Scenario: an "A" pattern matches only an added path
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, deleted, human, modified, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("start", { message: "go" })
        if (added("NOTE.md").length > 0) await human("added", { message: "added" })
        else if (modified("NOTE.md").length > 0) await human("modified", { message: "modified" })
        else if (deleted("NOTE.md").length > 0) await human("deleted", { message: "deleted" })
        else
          refuse(
            "gtd land: no declared pattern matches — declared patterns: A NOTE.md, M NOTE.md, D NOTE.md",
          )
      })
      """
    And a file "NOTE.md" with:
      """
      brand new
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → added"

  Scenario: an "M" pattern matches only a modified path
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, deleted, human, modified, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("start", { message: "go" })
        if (added("NOTE.md").length > 0) await human("added", { message: "added" })
        else if (modified("NOTE.md").length > 0) await human("modified", { message: "modified" })
        else if (deleted("NOTE.md").length > 0) await human("deleted", { message: "deleted" })
        else
          refuse(
            "gtd land: no declared pattern matches — declared patterns: A NOTE.md, M NOTE.md, D NOTE.md",
          )
      })
      """
    And a commit "chore: seed" that adds "NOTE.md" with:
      """
      seed content
      """
    And "NOTE.md" is modified to:
      """
      changed content
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → modified"

  Scenario: a "D" pattern matches only a deleted path
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, deleted, human, modified, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("start", { message: "go" })
        if (added("NOTE.md").length > 0) await human("added", { message: "added" })
        else if (modified("NOTE.md").length > 0) await human("modified", { message: "modified" })
        else if (deleted("NOTE.md").length > 0) await human("deleted", { message: "deleted" })
        else
          refuse(
            "gtd land: no declared pattern matches — declared patterns: A NOTE.md, M NOTE.md, D NOTE.md",
          )
      })
      """
    And a commit "chore: seed" that adds "NOTE.md" with:
      """
      seed content
      """
    And the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → deleted"

  Scenario: a "*" status pattern matches any change kind
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { changed, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("start", { message: "go" })
        if (changed("NOTE.md").length === 0) {
          refuse("gtd land: no declared pattern matches — declared patterns: * NOTE.md")
        }
        await human("any-change", { message: "matched" })
      })
      """
    And a file "NOTE.md" with:
      """
      brand new
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → any-change"

  Scenario: a single-segment glob does not cross a path separator
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { changed, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("start", { message: "go" })
        if (changed(".gtd/*").length === 0) {
          refuse("gtd land: no declared pattern matches — declared patterns: * .gtd/*")
        }
        await human("shallow", { message: "matched" })
      })
      """
    And a file ".gtd/sub/DEEP.md" with:
      """
      nested
      """
    When I run gtd land
    Then it fails
    And stderr contains "no declared pattern matches"
    And stderr contains ".gtd/*"

  Scenario: "**" matches a nested path across segments
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { changed, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("start", { message: "go" })
        if (changed(".gtd/**").length === 0) {
          refuse("gtd land: no declared pattern matches — declared patterns: * .gtd/**")
        }
        await human("deep", { message: "matched" })
      })
      """
    And a file ".gtd/sub/DEEP.md" with:
      """
      nested
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → deep"

  Scenario: the first matching pattern in declaration order wins
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, changed, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        await human("start", { message: "go" })
        if (changed("NOTE.md").length > 0) await human("first-match", { message: "matched first" })
        else if (added("NOTE.md").length > 0) await human("second-match", { message: "matched second" })
        else refuse("gtd land: no declared pattern matches — declared patterns: * NOTE.md, A NOTE.md")
      })
      """
    And a file "NOTE.md" with:
      """
      brand new
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → first-match"

  Scenario: the bare "C" token matches only a clean tree
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { changed, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        // acceptClean: a landing that changes nothing completes the gate.
        await human("start", { message: "go", acceptClean: true })
        if (changed().length === 0) await human("settled", { message: "clean" })
      })
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): start → settled"

  Scenario: a clean tree with no declared "C" event is a silent no-op
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow(async () => {
        // No acceptClean: a clean landing leaves the gate waiting for a change.
        await human("start", { message: "go" })
        await agent("working", "...")
      })
      """
    And I record the commit count
    When I run gtd land
    Then it succeeds
    And the commit count is unchanged
