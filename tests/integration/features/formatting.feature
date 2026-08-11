@live
Feature: Markdown formatting is the project's own tool, plugged into a steering-file mode

  gtd ships no formatter (there is no `gtd format` subcommand, and no prettier
  inside the binary). A project that wants its steering files auto-formatted
  brings its own tool and declares it as a `format:` command on the mode those
  files use — a top-level `.gtdrc` `modes:` key layered over the configured
  workflow is enough, without re-declaring that mode on the workflow itself
  (see docs/configuration.md's "modes:" section). Formatting runs where
  validation runs: `gtd validate`, and the `gtd land` capture gate.

  A git `pre-commit` hook remains a perfectly good alternative, and the last
  scenarios pin that it still works — gtd never fights it.

  Scenario: prettier plugged into the workflow's qa mode via a top-level modes: key rewraps TODO.md
    Given a test project
    And prettier is available in the test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          format: "npx prettier --write <%= it.file %>"
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": grilling
              grilling:
                actor: agent
                file: .gtd/TODO.md
                mode: qa
                prompt: "plan"
                on:
                  "* **": grilling-answer
              grilling-answer:
                actor: human
                file: .gtd/TODO.md
                mode: qa
                message: "answer"
                on:
                  "C": idle
                  "* **": grilling
      """
    And a commit "gtd(human): grilling" that adds ".gtd/TODO.md" with:
      """
      This is a very long line that exceeds eighty characters and should be wrapped by prettier when gtd validates it.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/TODO.md: valid"
    And ".gtd/TODO.md" has no lines longer than 80 characters

  Scenario: the step capture gate formats with the same command before committing the turn
    Given a test project
    And prettier is available in the test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          format: "npx prettier --write <%= it.file %>"
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": grilling
              grilling:
                actor: agent
                file: .gtd/TODO.md
                mode: qa
                prompt: "plan"
                on:
                  "* **": grilling-answer
              grilling-answer:
                actor: human
                file: .gtd/TODO.md
                mode: qa
                message: "answer"
                on:
                  "C": idle
                  "* **": grilling
      """
    And a commit "gtd(human): grilling-answer" that adds ".gtd/TODO.md" with:
      """
      A plan.
      """
    And ".gtd/TODO.md" is modified to:
      """
      A plan. This answer line is deliberately far longer than eighty characters so that the formatter has to rewrap it before the turn is captured.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): grilling-answer → grilling"
    And ".gtd/TODO.md" has no lines longer than 80 characters

  Scenario: Pre-commit hook wraps long lines in TODO.md
    Given a test project
    And prettier is available in the test project
    And an executable pre-commit hook with:
      """
      #!/bin/sh
      FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^\.gtd/(TODO|REVIEW)\.md$')

      if [ -n "$FILES" ]; then
        npx prettier --write $FILES
        git add $FILES
      fi
      """
    And a file ".gtd/TODO.md" with:
      """
      This is a very long line that exceeds eighty characters and should be wrapped by prettier when committed.
      """
    And ".gtd/TODO.md" is staged
    When I commit with message "docs: test formatting"
    Then ".gtd/TODO.md" has no lines longer than 80 characters

  Scenario: Pre-commit hook wraps long lines in REVIEW.md
    Given a test project
    And prettier is available in the test project
    And an executable pre-commit hook with:
      """
      #!/bin/sh
      FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^\.gtd/(TODO|REVIEW)\.md$')

      if [ -n "$FILES" ]; then
        npx prettier --write $FILES
        git add $FILES
      fi
      """
    And a file ".gtd/REVIEW.md" with:
      """
      This is a very long line that exceeds eighty characters and should be wrapped by prettier when committed.
      """
    And ".gtd/REVIEW.md" is staged
    When I commit with message "review: test formatting"
    Then ".gtd/REVIEW.md" has no lines longer than 80 characters

  Scenario: prettier plugged into the bundled default's plan mode via a top-level modes: key formats the agent-authored plan at plan.planning
    # No `workflow:` re-declaration: the bundled default already gives
    # `plan.planning`/`plan.await-plan` `mode: prose` (see unified.yaml); a top-level
    # `modes:` key alone is enough to plug a formatter into it.
    Given a test project
    And prettier is available in the test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        prose:
          format: "npx prettier --write <%= it.file %>"
      """
    And a commit "gtd(human): plan.planning" that adds ".gtd/TODO.md" with:
      """
      This is a deliberately long single prose line for the plan file that clearly exceeds the eighty character print width.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): plan.planning → plan.await-plan"
    And ".gtd/TODO.md" has no lines longer than 80 characters

  Scenario: prettier plugged into the bundled default's plan mode formats the human-edited plan at plan.await-plan
    Given a test project
    And prettier is available in the test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        prose:
          format: "npx prettier --write <%= it.file %>"
      """
    And a commit "gtd(agent): plan.await-plan" that adds ".gtd/TODO.md" with:
      """
      A plan.
      """
    And ".gtd/TODO.md" is modified to:
      """
      A plan. This edited line is deliberately far longer than eighty characters so the formatter has to rewrap it before the turn is captured.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): plan.await-plan → plan.planning"
    And ".gtd/TODO.md" has no lines longer than 80 characters

  Scenario: gtd validate formats the plan file and reports it valid — prose has no validator to fail
    Given a test project
    And prettier is available in the test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        prose:
          format: "npx prettier --write <%= it.file %>"
      """
    And a commit "gtd(human): plan.planning" that adds ".gtd/TODO.md" with:
      """
      This is a deliberately long single prose line for the plan file that clearly exceeds the eighty character print width.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/TODO.md: valid"
    And ".gtd/TODO.md" has no lines longer than 80 characters

  Scenario: Pre-commit hook does not modify other markdown files
    Given a test project
    And prettier is available in the test project
    And an executable pre-commit hook with:
      """
      #!/bin/sh
      FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^\.gtd/(TODO|REVIEW)\.md$')

      if [ -n "$FILES" ]; then
        npx prettier --write $FILES
        git add $FILES
      fi
      """
    And a file "notes.md" with:
      """
      This is a very long line that exceeds eighty characters and should NOT be wrapped because it is not TODO or REVIEW.
      """
    And "notes.md" is staged
    When I commit with message "docs: test other file"
    Then "notes.md" still has a line longer than 80 characters
