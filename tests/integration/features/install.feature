Feature: gtd install — the driver-building briefing and the workflows config

  `gtd install` prints a complete, self-contained briefing that teaches an
  agent (or a human) to build a gtd driver in any shell or runtime. At a
  repository root no `gtd.config.ts` governs yet, it also writes one that
  imports gtd's shipped workflows from `@pmelab/gtd/workflows`, left
  uncommitted like `gtd init`'s file; anywhere else it writes nothing. Its
  `needs: "none"` (like `gtd lsp`) means it runs from any directory, in or out
  of a repository, and takes no argument.

  @inmem
  Scenario: at a repository root with no gtd.config.ts, it scaffolds one importing the shipped workflows
    Given a test project
    And I record the commit count
    When I run gtd with args "install"
    Then it succeeds
    And stdout contains "gtd door"
    And stderr contains "gtd install: wrote gtd.config.ts"
    And "gtd.config.ts" contains "feature as default,"
    And "gtd.config.ts" contains "doors,"
    And "gtd.config.ts" contains "} from \"@pmelab/gtd/workflows\""
    And the commit count is unchanged

  @inmem
  Scenario: the scaffolded config runs the shipped feature workflow once committed
    Given a test project
    And I run gtd with args "install"
    And the working tree is committed
    When I run gtd next
    Then it succeeds
    And stdout contains "State: idle"
    And stdout contains "Workflow: feature"
    When I run gtd with args "doors"
    Then it succeeds
    And stdout contains "fix → fix"
    And stdout contains "review [base] → review"

  @inmem
  Scenario: a repository with its own gtd.config.ts is left untouched
    Given a test project
    And the workflow gtd install scaffolds
    And I record the commit count
    When I run gtd with args "install"
    Then it succeeds
    And stderr does not contain "wrote gtd.config.ts"
    And the commit count is unchanged
    And the git status is clean

  @inmem
  Scenario: the briefing obliges a skill-restricting driver to pass each turn's skills
    Given a test project
    When I run gtd with args "install"
    Then it succeeds
    And stdout contains "11. When the chosen agent CLI can restrict which skills a turn sees"
    And stdout contains "--json=skills"
    And stdout contains "`claude -p` cannot"

  @inmem
  Scenario: the briefing obliges a sandboxing driver to map each turn's access
    Given a test project
    When I run gtd with args "install"
    Then it succeeds
    And stdout contains "12. Map each prompt turn's `--json=access.read`"
    And stdout contains "workspace-write"
    And stdout contains ":ro"

  @inmem
  Scenario: succeeds in a repository with no commits — there is no workflow state to resolve
    Given a git repository with no commits
    When I run gtd with args "install"
    Then it succeeds

  @inmem
  Scenario: --json is not gtd install's own surface — a usage error like every other non-next command
    Given a test project
    When I run gtd with args "install --json"
    Then it fails
    And stderr contains "only valid for `gtd next`"
    And stderr contains "gtd install"

  @inmem
  Scenario: gtd install takes no arguments and no out-of-scope flags
    Given a test project
    When I run gtd with args "install extra"
    Then it fails
    When I run gtd with args "install --port 3"
    Then it fails

  @inmem
  Scenario: the briefing installs one gtd-door script beside gtd-build and gtd-edit, and supersedes gtd-fix and gtd-review
    Given a test project
    When I run gtd with args "install"
    Then it succeeds
    And stdout contains "~/.local/bin/gtd-door"
    And stdout contains "script=\"$(gtd door \"$@\")\""
    And stdout contains "usage: gtd-door <name> [args...]"
    And stdout does not contain "~/.local/bin/gtd-review"
    And stdout does not contain "~/.local/bin/gtd-fix"
    And stdout contains "superseded by `gtd-door`"
    And stdout contains "ask before removing it"

  @inmem
  Scenario: the briefing names every field the current gtd next --json payload carries (drift guard)
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        await scope({ model: "smart" }, () =>
          agent("working", "do the work described in NOTE.md", {
            label: "Doing the work",
            file: ".gtd/PLAN.md",
            mode: "qa",
          }),
        )
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file ".gtd/PLAN.md" with:
      """
      a prior draft, so the validate field resolves
      """
    When I run gtd next with "--json"
    Then it succeeds
    And I record the JSON keys of stdout as "status"

    When I run gtd with args "install"
    Then it succeeds
    And stdout contains every JSON key recorded as "status"

  @live
  Scenario: from a repository subdirectory, it writes no gtd.config.ts anywhere
    Given a subdirectory of a test project
    When I run gtd with args "install"
    Then it succeeds
    And stderr does not contain "wrote gtd.config.ts"
    And "gtd.config.ts" does not exist
    And "../../gtd.config.ts" does not exist

  @live
  Scenario: outside any git repository, it writes no gtd.config.ts
    Given a plain directory that is not a git repository
    When I run gtd with args "install"
    Then it succeeds
    And stderr does not contain "wrote gtd.config.ts"
    And "gtd.config.ts" does not exist
