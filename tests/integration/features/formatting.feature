@live
Feature: Markdown formatting is the project's own tool, plugged into a steering-file mode

  gtd ships no formatter (there is no `gtd format` subcommand, and no prettier
  inside the binary). A project that wants its steering files auto-formatted
  brings its own tool and declares it as a `format:` command on the mode those
  files use — a top-level `.gtdrc` `modes:` key layered over the configured
  workflow is enough, without re-declaring that mode on the workflow itself
  (see docs/configuration.md's "modes:" section). Formatting runs where
  validation runs: `gtd validate`, and `gtd next --json`'s own `validate`
  field — never `gtd land`'s own emitted script any more (package 2,
  Requirement A): that script is only the HEAD assertion and the commit, so a
  driver that wants a steering file formatted before it lands must run the
  mode's format/validate script itself first.

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
                file: TODO.md
                mode: qa
                prompt: "plan"
                on:
                  "* **": grilling-answer
              grilling-answer:
                actor: human
                file: TODO.md
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

  Scenario: gtd land no longer formats before committing the turn — gtd validate is what still runs the mode's format command
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
                file: TODO.md
                mode: qa
                prompt: "plan"
                on:
                  "* **": grilling-answer
              grilling-answer:
                actor: human
                file: TODO.md
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
    # Package 2, Requirement A: `gtd land`'s own emitted script carries no
    # format command any more, so the long line survives the capture as-is —
    # a driver wanting it wrapped first must run `gtd validate` (or
    # `gtd next --json`'s own `validate` field) ahead of `gtd land`.
    When I run gtd with args "validate"
    Then it succeeds
    And ".gtd/TODO.md" has no lines longer than 80 characters
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): grilling-answer → grilling"

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

  Scenario: prettier plugged into the bundled default's qa mode via a top-level modes: key formats the agent-authored requirements at design.triage, when gtd validate runs it first
    # No `workflow:` re-declaration: the bundled default already gives
    # `design.triage` `mode: qa` (see unified.yaml); a top-level `modes:` key
    # alone is enough to plug a formatter into it. `gtd land` itself no
    # longer runs the format command (package 2, Requirement A) — a driver
    # wanting the file wrapped first runs `gtd validate` ahead of `gtd land`.
    Given a test project
    And prettier is available in the test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          format: "npx prettier --write <%= it.file %>"
      """
    And a commit "gtd(human): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      This is a deliberately long single prose line for the requirements file that clearly exceeds the eighty character print width.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And ".gtd/REQUIREMENTS.md" has no lines longer than 80 characters
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.check"

  Scenario: prettier plugged into the bundled default's qa mode formats the human-edited requirements at design.gate.answer, when gtd validate runs it first
    Given a test project
    And prettier is available in the test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          format: "npx prettier --write <%= it.file %>"
      """
    And a commit "gtd(agent): design.gate.answer" that adds ".gtd/REQUIREMENTS.md" with:
      """
      A plan.
      """
    And ".gtd/REQUIREMENTS.md" is modified to:
      """
      A plan. This edited line is deliberately far longer than eighty characters so the formatter has to rewrap it before the turn is captured.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And ".gtd/REQUIREMENTS.md" has no lines longer than 80 characters
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): design.gate.answer → design.triage"

  Scenario: gtd validate formats the requirements file at design.triage and reports it valid — plain prose with no Open Questions passes the qa validator trivially
    Given a test project
    And prettier is available in the test project
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        qa:
          format: "npx prettier --write <%= it.file %>"
      """
    And a commit "gtd(human): design.triage" that adds ".gtd/REQUIREMENTS.md" with:
      """
      This is a deliberately long single prose line for the requirements file that clearly exceeds the eighty character print width.
      """
    When I run gtd with args "validate"
    Then it succeeds
    And stdout contains ".gtd/REQUIREMENTS.md: valid"
    And ".gtd/REQUIREMENTS.md" has no lines longer than 80 characters

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
