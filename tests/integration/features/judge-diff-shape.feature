Feature: judgeDiffShape — a naive pass's strays judged as land, refactor-first or reject

  `judgeDiffShape(name, { changes, allow })` judges the paths a change set
  touched outside an allowlist. No strays answers `land` without a judge step;
  an answer below `minP`, a missing verdict or an unknown label answers
  `refactor-first`.

  @inmem
  Scenario: a naive pass touching only the allowlist lands with no judge step
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version", { keep: true })
        const { choice, judgment } = await judgeDiffShape("shape", {
          changes: kept("naive")?.changes ?? [],
          allow: ["src/**"],
        })
        if (judgment?.truncated.length) {
          await agent("cut", "evidence was cut: " + judgment.truncated.join(","))
        } else if (choice === "land") await agent("landing", "land the naive pass")
        else if (choice === "refactor-first") await agent("refactoring", "refactor first")
        else await agent("rejecting", "discard and re-implement")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And a file "src/naive.ts" with:
      """
      export const naive = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): naive → landing"
    And the last commit body does not contain "Gtd-Judge:"

  @inmem
  Scenario Outline: a judged answer routes to its branch
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version", { keep: true })
        const { choice, judgment } = await judgeDiffShape("shape", {
          changes: kept("naive")?.changes ?? [],
          allow: ["src/**"],
        })
        if (judgment?.truncated.length) {
          await agent("cut", "evidence was cut: " + judgment.truncated.join(","))
        } else if (choice === "land") await agent("landing", "land the naive pass")
        else if (choice === "refactor-first") await agent("refactoring", "refactor first")
        else await agent("rejecting", "discard and re-implement")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And a file "src/naive.ts" with:
      """
      export const naive = fixture
      """
    And a file "tests/fixture.ts" with:
      """
      export const fixture = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): naive → shape"
    And a file "answers.json" with:
      """
      [{"id":"shape","answer":"<answer>","p":<p>}]
      """
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider fixed --answers answers.json | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): shape → <target>"
    And the last commit body contains "Gtd-Judge:"

    Examples:
      | answer         | p    | target      |
      | land           | 0.9  | landing     |
      | reject         | 0.9  | rejecting   |
      | refactor-first | 0.8  | refactoring |
      | land           | 0.69 | refactoring |
      | shrug          | 1    | refactoring |

  @inmem
  Scenario: landing with a clean tree leaves no verdict and takes refactor-first
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version", { keep: true })
        const { choice, judgment } = await judgeDiffShape("shape", {
          changes: kept("naive")?.changes ?? [],
          allow: ["src/**"],
        })
        if (judgment?.truncated.length) {
          await agent("cut", "evidence was cut: " + judgment.truncated.join(","))
        } else if (choice === "land") await agent("landing", "land the naive pass")
        else if (choice === "refactor-first") await agent("refactoring", "refactor first")
        else await agent("rejecting", "discard and re-implement")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And a file "src/naive.ts" with:
      """
      export const naive = fixture
      """
    And a file "tests/fixture.ts" with:
      """
      export const fixture = 1
      """
    When I run gtd land
    Then it succeeds
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): shape → refactoring"
    And the last commit body does not contain "Gtd-Judge:"

  @inmem
  Scenario: a workflow declaring judgeShapeMinP 0.95 sends a p 0.9 land answer to refactor-first
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version", { keep: true })
        const { choice, judgment } = await judgeDiffShape("shape", {
          changes: kept("naive")?.changes ?? [],
          allow: ["src/**"],
        })
        if (judgment?.truncated.length) {
          await agent("cut", "evidence was cut: " + judgment.truncated.join(","))
        } else if (choice === "land") await agent("landing", "land the naive pass")
        else if (choice === "refactor-first") await agent("refactoring", "refactor first")
        else await agent("rejecting", "discard and re-implement")
      }

      export const defaults = { judgeShapeMinP: "0.95" }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And a file "src/naive.ts" with:
      """
      export const naive = fixture
      """
    And a file "tests/fixture.ts" with:
      """
      export const fixture = 1
      """
    When I run gtd land
    Then it succeeds
    And a file "answers.json" with:
      """
      [{"id":"shape","answer":"land","p":0.9}]
      """
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider fixed --answers answers.json | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): shape → refactoring"

  @inmem
  Scenario: the judge's strays equal what gtd strays prints for the kept range
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version", { keep: true })
        const { choice, judgment } = await judgeDiffShape("shape", {
          changes: kept("naive")?.changes ?? [],
          allow: ["src/**"],
        })
        if (judgment?.truncated.length) {
          await agent("cut", "evidence was cut: " + judgment.truncated.join(","))
        } else if (choice === "land") await agent("landing", "land the naive pass")
        else if (choice === "refactor-first") await agent("refactoring", "refactor first")
        else await agent("rejecting", "discard and re-implement")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And I mark the current commit as "entry"
    And I mark the current commit as "before"
    And a file "src/naive.ts" with:
      """
      export const naive = fixture
      """
    And a file "tests/fixture.ts" with:
      """
      export const fixture = 1
      """
    And a file "Z.ts" with:
      """
      export const z = 1
      """
    When I run gtd land
    Then it succeeds
    When I run gtd with args "judge --json"
    Then it succeeds
    And stdout contains "=== Z.ts (added)\n--- after\nexport const z = 1\n\n=== tests/fixture.ts (added)"
    And stdout contains "\"allow\":"
    And stdout contains "\"inAllowlist\":"
    And stdout contains "src/naive.ts"
    And stdout contains "=== tests/fixture.ts (added)"
    And stdout contains "export const fixture = 1"
    And stdout does not contain "export const naive"
    Given I mark the kept ref of "entry" for step "naive" as "kept"
    When I run gtd with args "strays before..kept src/**"
    Then the exit code is 10
    And stdout is:
      """
      ["Z.ts","tests/fixture.ts"]
      """

  @inmem
  Scenario: a modified stray shows its content before and after in the judge's state
    Given a test project
    And a file "tests/old.ts" with:
      """
      export const old = 1
      """
    And the working tree is committed as "chore: add old"
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape, kept } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version", { keep: true })
        const { choice, judgment } = await judgeDiffShape("shape", {
          changes: kept("naive")?.changes ?? [],
          allow: ["src/**"],
        })
        if (judgment?.truncated.length) {
          await agent("cut", "evidence was cut: " + judgment.truncated.join(","))
        } else if (choice === "land") await agent("landing", "land the naive pass")
        else if (choice === "refactor-first") await agent("refactoring", "refactor first")
        else await agent("rejecting", "discard and re-implement")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And a file "src/naive.ts" with:
      """
      export const naive = fixture
      """
    And a file "tests/old.ts" with:
      """
      export const old = 2
      """
    And a file "tests/fixture.ts" with:
      """
      export const fixture = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): naive → shape"
    When I run gtd with args "judge --json"
    Then it succeeds
    And stdout contains "=== tests/old.ts (modified)"
    And stdout contains "--- before"
    And stdout contains "export const old = 1"
    And stdout contains "--- after"
    And stdout contains "export const old = 2"

  @inmem
  Scenario: a stray whose content cannot be read takes refactor-first with no judge step
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judgeDiffShape } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await agent("naive", "write the naive version")
        const { choice, unreadable } = await judgeDiffShape("shape", {
          changes: [{ path: "vendor/big.bin", status: "modified", before: undefined, after: "x" }],
          allow: ["src/**"],
        })
        if (unreadable.length) await agent("human-look", "unreadable: " + unreadable.join(","))
        else if (choice === "land") await agent("landing", "land the naive pass")
        else await agent("refactoring", "refactor first")
      }
      """
    And the working tree is committed as "chore: gtd config"
    And a file "NOTE.md" with:
      """
      Build a thing.
      """
    And gtd lands "gtd(human): idle → naive"
    And a file "src/naive.ts" with:
      """
      export const naive = 1
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): naive → human-look"
    And the last commit body does not contain "Gtd-Judge:"
