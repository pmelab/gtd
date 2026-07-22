@inmem
Feature: The advanced example's picking arbiter — a per-task queue loop via a custom workflow

  Coverage for the deterministic queue-arbiter shape documented at
  docs/examples/advanced-workflow.md (formerly part of the bundled default,
  now a copy-paste `.gtdrc` recipe — see
  docs/design/work-packages.md "Option A"): a `script` state (`picking`) that
  takes the first task file under `.gtd/tasks/` into `.gtd/NEXT.md`, or
  removes `.gtd/NEXT.md` once the queue is empty, with an order-sensitive `on`
  map (`"D .gtd/NEXT.md"` declared before the wildcard-status
  `"* .gtd/NEXT.md"` row — a `*` status matches every status including `D`,
  see STATES.md §3). A minimal 4-state custom workflow stands in for the
  fuller example; @inmem simulates the arbiter's script by writing/deleting
  `.gtd/NEXT.md` directly and running `gtd step check`.

  Scenario: the arbiter feeds a two-task queue one task at a time, then closes out once it empties
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "write task files under .gtd/tasks/, then run `gtd step human`"
            on:
              "* **": picking
          picking:
            actor: check
            script: |
              #!/usr/bin/env bash
              next=$(ls .gtd/tasks/*.md 2>/dev/null | head -n 1)
              if [ -n "$next" ]; then
                printf '%s' "$next" > .gtd/NEXT.md
              else
                rm -f .gtd/NEXT.md
              fi
            on:
              "D .gtd/NEXT.md": done
              "* .gtd/NEXT.md": building
              "C": done
          building:
            actor: agent
            prompt: "Implement the task named in .gtd/NEXT.md, then delete that task file."
            on:
              "* **": picking
          done:
            commit: "chore: tasks complete"
      """
    And a file ".gtd/tasks/01-a.md" with:
      """
      Task A
      """
    And a file ".gtd/tasks/02-b.md" with:
      """
      Task B
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): picking"

    # picking (task 1 of 2): the arbiter takes the first task file by name
    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/tasks/01-a.md
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): building"

    # building (task 1): implements it, deletes the task file, back to picking
    Given the file ".gtd/tasks/01-a.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): picking"

    # picking (task 2 of 2): overwrites NEXT.md with the one remaining task
    Given ".gtd/NEXT.md" is modified to:
      """
      .gtd/tasks/02-b.md
      """
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "gtd(check): building"

    # building (task 2): implements it, deletes the task file, back to picking
    Given the file ".gtd/tasks/02-b.md" is deleted
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): picking"

    # picking: the queue is now empty — deleting NEXT.md matches "D .gtd/NEXT.md"
    # (declared before the wildcard row) and closes the cycle out via "done"
    Given the file ".gtd/NEXT.md" is deleted
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "chore: tasks complete"
    And the git status is clean

  Scenario: an empty queue on the very first entry into picking matches the clean "C" row directly
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "write task files under .gtd/tasks/, then run `gtd step human`"
            on:
              "* **": picking
          picking:
            actor: check
            script: |
              #!/usr/bin/env bash
              next=$(ls .gtd/tasks/*.md 2>/dev/null | head -n 1)
              if [ -n "$next" ]; then
                printf '%s' "$next" > .gtd/NEXT.md
              else
                rm -f .gtd/NEXT.md
              fi
            on:
              "D .gtd/NEXT.md": done
              "* .gtd/NEXT.md": building
              "C": done
          building:
            actor: agent
            prompt: "Implement the task named in .gtd/NEXT.md, then delete that task file."
            on:
              "* **": picking
          done:
            commit: "chore: tasks complete"
      """
    And a file "NOTE.md" with:
      """
      no tasks this time — just a placeholder edit
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): picking"

    # picking: .gtd/tasks/ was already empty, so a clean step matches "C" directly
    When I run gtd step check
    Then it succeeds
    And the last commit subject is "chore: tasks complete"
    And the git status is clean
