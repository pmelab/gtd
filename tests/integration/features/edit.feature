@live
Feature: gtd edit — opening a target path in the human's editor

  `bin/gtd edit [path]` (see bin/gtd's own dispatch comment) opens
  `${VISUAL:-$EDITOR}` on `path` when given, or — with no argument — on the
  file the machine currently rests at (`gtd next --json`'s `.file`), falling
  back to the repo directory (`.`) when the resting state declares no `file:`.
  With neither `$EDITOR` nor `$VISUAL` configured, it refuses rather than
  silently doing nothing. Real subprocess execution against a fake,
  non-interactive editor script standing in for a real `$EDITOR`, so this
  feature runs `@live`.

  Scenario: gtd edit <path> opens the given path in the editor
    Given a test project
    And $EDITOR is a script that appends "hello from the fake editor" to the opened file
    When I run gtd edit "NOTE.md"
    Then it succeeds
    And the fake editor was opened on "NOTE.md"
    And "NOTE.md" contains "hello from the fake editor"

  Scenario: gtd edit with no argument opens the resting state's declared file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            file: NOTE.md
            message: "write NOTE.md to start a cycle"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And $EDITOR is a script that appends "sketch written by the fake editor" to the opened file
    When I run gtd edit with no argument
    Then it succeeds
    And the fake editor was opened on "NOTE.md"
    And "NOTE.md" contains "sketch written by the fake editor"

  Scenario: gtd edit with no argument opens the repo directory when the resting state declares no file
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "write NOTE.md to start a cycle"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And $EDITOR is a no-op script
    When I run gtd edit with no argument
    Then it succeeds
    And the fake editor was opened on "."

  Scenario: gtd edit refuses when neither $EDITOR nor $VISUAL is configured
    Given a test project
    And $EDITOR is a script that appends "should never be seen" to the opened file
    And $EDITOR is unset
    When I run gtd edit "NOTE.md"
    Then it fails
    And stderr contains "$EDITOR"
    And the fake editor was not invoked
    And "NOTE.md" does not exist
