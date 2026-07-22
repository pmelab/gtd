@live
Feature: A "./"-relative content value is a file reference, inlined at load time

  Pins `PatternConfig`'s file-reference rule (see its module docstring, "File
  references"): a `script`/`prompt`/`message`/`commit` value starting with
  `./` or `../` is read from disk relative to the config file's own directory
  and inlined at load time — real disk I/O, so this feature runs `@live`. A
  missing file reference is a load error naming both the file and the state.

  Scenario: a "./"-relative prompt value is inlined from a file next to the config
    Given a test project
    And a file ".gtdrc" with:
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
            prompt: ./prompt.md
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And a file "prompt.md" with:
      """
      Build the thing described in NOTE.md.
      """
    And ".gtdrc" is staged
    And "prompt.md" is staged
    When I commit with message "chore: add config"
    Given a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Build the thing described in NOTE.md."

  Scenario: a missing "./"-relative content value is a load error naming the file and state
    Given a test project
    And a file ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: ./missing-message.md
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And ".gtdrc" is staged
    When I commit with message "chore: add config"
    When I run gtd status
    Then it fails
    And stderr contains "missing-message.md"
    And stderr contains "does not exist"
    And stderr contains "idle"
