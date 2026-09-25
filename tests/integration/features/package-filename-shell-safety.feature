@live
Feature: A package filename carrying shell syntax never executes it

  `packages.spec.scoping` and `packages.closing` (`src/workflows/unified.yaml`)
  both render `it.item` — the `.gtd/packages/*.md` glob's raw, untrusted
  filename — into a `script:`'s `pkg=` assignment. Double quotes there stop
  word-splitting but not `$(...)`, a backtick, or `$var`; a package file named
  with a command substitution would run that command as the reviewer, not
  just read it as a path. Both call sites are single-quoted instead, which
  Eta's own autoescaping keeps safe (a literal `'` in the filename renders as
  `&#39;`, never breaking out of the quoting). This drives the bundled
  `packages` loop far enough to render both scripts for real and asserts the
  embedded command never ran.

  Scenario: a package file named with a command substitution renders inert in both spec.scoping and closing
    Given a test project
    And the workflow
    And a file "src/greeter.ts" with:
      """
      export const greet = () => "hi"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"

    Given the file "src/greeter.ts" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): unwind → start-gate.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      ## Greeting export

      Add a `greet()` export returning a friendly string.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): design.triage → design.gate.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): design.gate.check → architecture-pre"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): architecture-pre → architecture.author"

    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan: src/greeter.ts exports `greet`, no dependencies.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.author → architecture.gate.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): architecture.gate.check → architecture.decompose"

    # The package's own filename IS the exploit attempt: a command
    # substitution that, if ever run unquoted by a rendered script, touches
    # "marker" in the repo root.
    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-$(touch marker).md" with:
      """
      Package: the greeting export. Independent tasks:
      - [ ] add src/greeter.ts exporting `greet`
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): architecture.decompose → packages-sweep"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages-sweep → packages[0].building"

    Given "src/greeter.ts" is modified to:
      """
      export const greet = (): string => "hi"
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages[0].building → packages[0].health.check"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages[0].health.check → packages[0].spec.pre"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(judge): packages[0].spec.pre → packages[0].spec.scoping"

    # packages[0].spec.scoping: the state under test renders `pkg='<%= it.item
    # %>'` with the malicious filename and actually runs it via a real shell.
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    And "marker" does not exist
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages[0].spec.scoping → packages[0].spec.review"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages[0].spec.review → packages[0].closing"

    # packages[0].closing: the second call site under test, same filename,
    # same real-shell execution.
    When I run gtd next with "--json"
    Then it succeeds
    And I execute the printed check script
    And "marker" does not exist
