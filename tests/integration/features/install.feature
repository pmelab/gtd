@inmem
Feature: gtd install — the driver-building briefing

  `gtd install` prints a complete, self-contained briefing that teaches an
  agent (or a human) to build a gtd driver in any shell or runtime — it
  writes nothing at all, so "install" means installing knowledge into the
  calling agent's context, not writing files. Its `needs: "none"` (like
  `gtd lsp`) means it runs from any directory, in or out of a repository, and
  takes no argument.

  Scenario: prints the briefing without touching the repository
    Given a test project
    And I record the commit count
    When I run gtd with args "install"
    Then it succeeds
    And the commit count is unchanged
    And the git status is clean

  Scenario: succeeds in a repository with no commits — there is no workflow state to resolve
    Given a git repository with no commits
    When I run gtd with args "install"
    Then it succeeds

  Scenario: --json is not gtd install's own surface — a usage error like every other non-status command
    Given a test project
    When I run gtd with args "install --json"
    Then it fails
    And stderr contains "only valid for `gtd status`"
    And stderr contains "gtd install"

  Scenario: gtd install takes no arguments and no out-of-scope flags
    Given a test project
    When I run gtd with args "install extra"
    Then it fails
    When I run gtd with args "install --port 3"
    Then it fails

  Scenario: the briefing names every field the current gtd status --json payload carries (drift guard)
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            model: smart
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                label: "Doing the work"
                file: ".gtd/PLAN.md"
                mode: qa
                prompt: "do the work described in NOTE.md"
                on:
                  "A DONE.md": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file ".gtd/PLAN.md" with:
      """
      a prior draft, so the validate field resolves
      """
    When I run gtd status with "--json"
    Then it succeeds
    And I record the JSON keys of stdout as "status"

    When I run gtd with args "install"
    Then it succeeds
    And stdout contains every JSON key recorded as "status"
