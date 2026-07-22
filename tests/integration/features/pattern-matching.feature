@inmem
Feature: Pattern-matching grammar — statuses, glob depth, declaration order, clean event

  Pins `PatternMachine.matchesPattern`/`parsePattern` (see
  docs/design/pattern-machine-plan.md, decision 5) through the real CLI: each
  scenario declares a minimal custom `.gtdrc` `workflow:` isolating one
  grammar concern so the pattern under test is the only thing that could make
  it pass or fail.

  Scenario: an "A" pattern matches only an added path
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "A NOTE.md": added
              "M NOTE.md": modified
              "D NOTE.md": deleted
          added:
            actor: human
            message: "added"
          modified:
            actor: human
            message: "modified"
          deleted:
            actor: human
            message: "deleted"
      """
    And a file "NOTE.md" with:
      """
      brand new
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): added"

  Scenario: an "M" pattern matches only a modified path
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "A NOTE.md": added
              "M NOTE.md": modified
              "D NOTE.md": deleted
          added:
            actor: human
            message: "added"
          modified:
            actor: human
            message: "modified"
          deleted:
            actor: human
            message: "deleted"
      """
    And a commit "chore: seed" that adds "NOTE.md" with:
      """
      seed content
      """
    And "NOTE.md" is modified to:
      """
      changed content
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): modified"

  Scenario: a "D" pattern matches only a deleted path
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "A NOTE.md": added
              "M NOTE.md": modified
              "D NOTE.md": deleted
          added:
            actor: human
            message: "added"
          modified:
            actor: human
            message: "modified"
          deleted:
            actor: human
            message: "deleted"
      """
    And a commit "chore: seed" that adds "NOTE.md" with:
      """
      seed content
      """
    And the file "NOTE.md" is deleted
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): deleted"

  Scenario: a "*" status pattern matches any change kind
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "* NOTE.md": any-change
          any-change:
            actor: human
            message: "matched"
      """
    And a file "NOTE.md" with:
      """
      brand new
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): any-change"

  Scenario: a single-segment glob does not cross a path separator
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "* .gtd/*": shallow
          shallow:
            actor: human
            message: "matched"
      """
    And a file ".gtd/sub/DEEP.md" with:
      """
      nested
      """
    When I run gtd step human
    Then it fails
    And stderr contains "no declared pattern matches"
    And stderr contains ".gtd/*"

  Scenario: "**" matches a nested path across segments
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "* .gtd/**": deep
          deep:
            actor: human
            message: "matched"
      """
    And a file ".gtd/sub/DEEP.md" with:
      """
      nested
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): deep"

  Scenario: the first matching pattern in declaration order wins
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "* NOTE.md": first-match
              "A NOTE.md": second-match
          first-match:
            actor: human
            message: "matched first"
          second-match:
            actor: human
            message: "matched second"
      """
    And a file "NOTE.md" with:
      """
      brand new
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): first-match"

  Scenario: the bare "C" token matches only a clean tree
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "C": settled
          settled:
            actor: human
            message: "clean"
      """
    When I run gtd step human
    Then it succeeds
    And the last commit subject is "gtd(human): settled"

  Scenario: a clean tree with no declared "C" event is a silent no-op
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          start:
            actor: human
            initial: true
            message: "go"
            on:
              "* NOTE.md": working
          working:
            actor: agent
            message: "..."
      """
    And I record the commit count
    When I run gtd step human
    Then it succeeds
    And the commit count is unchanged
