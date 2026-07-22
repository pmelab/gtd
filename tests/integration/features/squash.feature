@inmem
Feature: Commit-state squash — a process collapses to one commit at its final state

  Pins decision 7 of docs/design/pattern-machine-plan.md end to end: entering
  a `commit:` state renders its template against the PENDING tree, squashes
  every turn the current process landed since it began into ONE commit on the
  process's start parent, and discards everything left uncommitted (the
  message file included) — never partially, and never at all if the render
  fails.

  Scenario: squashing collapses every turn since the process began into one commit on the start parent
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "go"
            on:
              "* **": drafting
          drafting:
            actor: agent
            prompt: "draft"
            on:
              "* **": revising
          revising:
            actor: human
            message: "revise or accept"
            on:
              "C": working
              "* **": drafting
          working:
            actor: agent
            prompt: "write COMMIT_MSG.md"
            on:
              "A COMMIT_MSG.md": done
              "M COMMIT_MSG.md": done
          done:
            commit: '<%~ it.read("COMMIT_MSG.md") %>'
      """
    And I record the commit count
    And a file "DRAFT.md" with:
      """
      v1
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): drafting"
    Given "DRAFT.md" is modified to:
      """
      v2
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): revising"
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): working"
    Given a file "COMMIT_MSG.md" with:
      """
      feat: draft workflow

      Body text.
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "feat: draft workflow"
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: add .gtdrc
      feat: draft workflow
      """
    And the commit count increased by 1
    And "DRAFT.md" exists
    And "COMMIT_MSG.md" does not exist

  Scenario: squashing discards any other uncommitted changes, not just the message file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "go"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "write COMMIT_MSG.md"
            on:
              "A COMMIT_MSG.md": done
              "M COMMIT_MSG.md": done
          done:
            commit: '<%~ it.read("COMMIT_MSG.md") %>'
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      note
      """
    And a file "COMMIT_MSG.md" with:
      """
      feat: finish

      Body.
      """
    And a file "SCRATCH.md" with:
      """
      leftover debug notes that should never be committed
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "feat: finish"
    And "SCRATCH.md" does not exist
    And "COMMIT_MSG.md" does not exist
    And the git status is clean

  Scenario: a failed commit-template render refuses the step and touches nothing
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "go"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "write COMMIT_MSG.md"
            on:
              "A COMMIT_MSG.md": done
              "M COMMIT_MSG.md": done
          done:
            commit: '<%~ it.read("MISSING.md") %>'
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      note
      """
    And I record the commit count
    And a file "COMMIT_MSG.md" with:
      """
      feat: never lands
      """
    When I run gtd step agent
    Then it fails
    And the commit count is unchanged
    And "COMMIT_MSG.md" exists
